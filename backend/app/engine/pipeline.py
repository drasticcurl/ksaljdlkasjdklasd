"""Orquestación del pipeline completo de 5 pasos (Tarea 12.1, Req 3-8, 10.5, 10.7).

Este módulo encadena, en **orden estricto**, los cinco pasos del Motor de
Procesamiento usando el directorio de trabajo del Job:

1. **UNIR** — normalizar cada clip a 9:16 y concatenar (``engine/normalize.py``).
2. **CORTAR_SILENCIOS** — recortar pausas con auto-editor (``engine/silence.py``).
3. **TRANSCRIBIR** — timestamps por palabra con faster-whisper (``engine/transcribe.py``).
4. **SUBTITULOS** — generar y quemar el ASS animado (``engine/subtitles.py``).
5. **MUSICA** — mezclar música de fondo con ducking (``engine/music.py``).

Garantías (Req 10.5, 10.7):

* **Reparto de porcentaje por paso** (según el diseño): cada paso reporta su
  inicio en el borde inferior de su rango y su finalización en el borde superior:
  UNIR ``0-25``, CORTAR_SILENCIOS ``25-40``, TRANSCRIBIR ``40-70``,
  SUBTITULOS ``70-90``, MUSICA ``90-100``.
* **Reporte de inicio y avance** de cada paso a través de un ``reporter``
  inyectable que recibe eventos :class:`EventoProgreso` (fuente que el Gestor de
  Jobs usa como verdad del progreso, Req 10.5).
* **Fallo de un paso detiene el pipeline** (Req 10.7, Propiedad 23): si un paso
  lanza una excepción, se reporta un evento en estado ``FALLIDO`` con
  ``error = {"paso", "motivo"}``, **no se ejecuta ningún paso posterior** y se
  devuelve un :class:`ResultadoPipeline` sin éxito.
* **Omisión del paso de música** cuando no hay un WAV válido (Req 8.3): el
  ``Video_Final`` es el video subtitulado.

Todos los pasos son **inyectables** (parámetros ``fn_*``) para poder sustituirlos
por dobles en las pruebas property-based sin depender de los binarios reales.

Referencias de requisitos: 3.x, 4.x, 5.x, 6.x, 7.x, 8.x, 10.5, 10.7.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple, Union

from app.engine.ai_review import corregir_grupos_ia
from app.engine.ffprobe import inspeccionar_clip
from app.engine.grouping import agrupar
from app.engine.music import NOMBRE_FINAL, mezclar_musica
from app.engine.normalize import unir_clips
from app.engine.proc import Runner, ejecutar_comando
from app.engine.remotion import (
    NOMBRE_PROPS_JSON,
    NOMBRE_REMOTION_MP4,
    RemotionError,
    renderizar_con_remotion,
)
from app.engine.silence import (
    NOMBRE_CORTADO,
    SilenceProcessingError,
    cortar_silencios,
)
from app.engine.subtitles import (
    NOMBRE_ASS,
    NOMBRE_SUBTITULADO,
    ConfiguracionSubtitulosError,
    SubtitulosError,
    generar_y_quemar_subtitulos,
)
from app.engine.risas import NOMBRE_SIN_RISAS, eliminar_risas
from app.engine.transcribe import NOMBRE_AUDIO, transcribir
from app.models.job import JobStatus, PipelineStep, TOTAL_PASOS
from app.models.settings import (
    Ajustes,
    DEFAULT_MOTOR_RENDER,
    GrupoSubtitulo,
    MotorRender,
)
from app.storage.workdir import JobWorkdir, preservar_video_final

logger = logging.getLogger(__name__)

# Nombre de la variable de entorno que activa el modo "fail-soft" del corte de
# silencios: si auto-editor falla, el pipeline continúa sin recortar en lugar de
# marcar el Job como fallido. Desactivado por defecto (Req 10.7).
ENV_SILENCE_FAILSOFT: str = "VSE_SILENCE_FAILSOFT"

# Nombre de la variable de entorno que activa el modo "fail-soft" del quemado de
# subtítulos: si el paso falla, el pipeline continúa SIN subtítulos usando el
# video de entrada del paso. Desactivado por defecto (Req 10.7).
ENV_SUBTITLES_FAILSOFT: str = "VSE_SUBTITLES_FAILSOFT"

# Motores de render válidos del paso SUBTITULOS (spec subtitulos-ia-remotion,
# Req 7.1). La elección efectiva la hace el usuario en tiempo de ejecución (dos
# botones) y el endpoint POST /render/{id} (tarea 8) la valida; aquí se
# comprueba de nuevo de forma defensiva antes de despachar el render.
_MOTORES_VALIDOS: Tuple[MotorRender, ...] = ("ass", "remotion")


def _env_flag_activo(nombre: str) -> bool:
    """Indica si una variable de entorno de tipo flag está activada.

    Se considera activa con valor en {"1", "true", "yes"} (sin importar
    mayúsculas/minúsculas ni espacios). Cualquier otro valor (o su ausencia) la
    mantiene desactivada.
    """
    valor = os.environ.get(nombre, "").strip().lower()
    return valor in {"1", "true", "yes"}


def _silence_failsoft_activo() -> bool:
    """Indica si el modo fail-soft del corte de silencios está activado (Req 10.7)."""
    return _env_flag_activo(ENV_SILENCE_FAILSOFT)


def _subtitles_failsoft_activo() -> bool:
    """Indica si el modo fail-soft del quemado de subtítulos está activado (Req 10.7)."""
    return _env_flag_activo(ENV_SUBTITLES_FAILSOFT)


# ---------------------------------------------------------------------------
# Reparto de porcentaje por paso (borde inferior, borde superior). Ver diseño,
# sección "Motor de Procesamiento".
# ---------------------------------------------------------------------------
RANGOS_PASOS: Dict[PipelineStep, Tuple[int, int]] = {
    PipelineStep.UNIR: (0, 25),
    PipelineStep.CORTAR_SILENCIOS: (25, 40),
    PipelineStep.TRANSCRIBIR: (40, 70),
    PipelineStep.SUBTITULOS: (70, 90),
    PipelineStep.MUSICA: (90, 100),
}

# Orden estricto de ejecución de los pasos (índice 1..5).
ORDEN_PASOS: List[PipelineStep] = [
    PipelineStep.UNIR,
    PipelineStep.CORTAR_SILENCIOS,
    PipelineStep.TRANSCRIBIR,
    PipelineStep.SUBTITULOS,
    PipelineStep.MUSICA,
]


@dataclass(frozen=True)
class EventoProgreso:
    """Evento de progreso emitido por el pipeline hacia el ``reporter``.

    Es la unidad de información que el Gestor de Jobs consume como fuente de
    verdad del progreso (Req 10.5). ``error`` solo se rellena en estado
    ``FALLIDO`` con la forma ``{"paso": ..., "motivo": ...}`` (Req 10.7).
    """

    estado: JobStatus
    indice_paso: int
    paso_actual: Optional[PipelineStep]
    porcentaje: int
    mensaje: str
    error: Optional[Dict[str, Any]] = None


# Firma del reporter de progreso inyectable.
ReporteProgreso = Callable[[EventoProgreso], None]


def _reporter_noop(_evento: EventoProgreso) -> None:
    """Reporter por defecto que descarta los eventos (sin efectos)."""


@dataclass
class ResultadoPipeline:
    """Resultado de ejecutar el pipeline completo.

    Attributes:
        exito: ``True`` si los cinco pasos (o los aplicables) completaron.
        ruta_video_final: Ruta persistente del ``Video_Final`` si hubo éxito.
        paso_fallido: Paso que falló, si ``exito`` es ``False`` (Req 10.7).
        motivo: Motivo del fallo, si ``exito`` es ``False`` (Req 10.7).
    """

    exito: bool
    ruta_video_final: Optional[Path] = None
    paso_fallido: Optional[PipelineStep] = None
    motivo: Optional[str] = None
    # Pausa por revisión manual de subtítulos: cuando ``pendiente_revision`` es
    # ``True`` el pipeline se detuvo tras la transcripción (fase 1) sin quemar
    # subtítulos ni mezclar música. ``cortado`` es el video sobre el que se
    # quemarán los subtítulos al reanudar y ``grupos`` son los grupos propuestos
    # para editar. En este caso ``exito`` es ``False`` (aún no hay video final).
    pendiente_revision: bool = False
    cortado: Optional[Path] = None
    grupos: Optional[List[GrupoSubtitulo]] = None
    # Pausa por elección de motor de render (spec subtitulos-ia-remotion, Req 6.1):
    # cuando ``pendiente_eleccion_render`` es ``True`` el pipeline preparó los
    # ``grupos`` finales (agrupación + corrección IA opcional) y se detuvo SIN
    # renderizar, a la espera de que el usuario elija el motor. ``cortado`` es el
    # video sobre el que se renderizará al reanudar con el motor elegido (tareas 7
    # y 8) y ``grupos`` contiene los grupos ya definitivos. En este caso ``exito``
    # es ``False`` (aún no hay Video_Final).
    pendiente_eleccion_render: bool = False


def ejecutar_pipeline(
    job: JobWorkdir,
    orden_clips: Sequence[str],
    ajustes: Ajustes,
    *,
    musica_wav: Optional[str] = None,
    api_key: Optional[str] = None,
    reporter: ReporteProgreso = _reporter_noop,
    runner: Runner = ejecutar_comando,
    inspector: Callable[[str], Any] = inspeccionar_clip,
    existe_salida: Optional[Callable[[Path], bool]] = None,
    # Pasos inyectables (por defecto, las implementaciones reales del motor).
    fn_unir: Callable[..., Path] = unir_clips,
    fn_cortar: Callable[..., Path] = cortar_silencios,
    fn_transcribir: Callable[..., List[Any]] = transcribir,
    fn_risas: Callable[..., Any] = eliminar_risas,
    fn_subtitulos: Callable[..., Path] = generar_y_quemar_subtitulos,
    fn_musica: Callable[..., Path] = mezclar_musica,
    fn_preservar: Callable[[JobWorkdir, Any], Path] = preservar_video_final,
) -> ResultadoPipeline:
    """Ejecuta los cinco pasos del pipeline en orden estricto (Req 3-8, 10.5, 10.7).

    Reporta el inicio (borde inferior del rango) y la finalización (borde
    superior) de cada paso. Ante el fallo de cualquier paso, reporta un evento
    ``FALLIDO`` con ``error = {"paso", "motivo"}``, **detiene** los pasos
    restantes y devuelve un :class:`ResultadoPipeline` sin éxito (Req 10.7).

    Args:
        job: Directorio de trabajo del Job (contención de temporales, Req 13.3).
        orden_clips: Rutas de los clips en el ``Orden_de_Clips`` del usuario.
        ajustes: Conjunto completo de ajustes del pipeline.
        musica_wav: Ruta del WAV de música, o ``None`` para omitir el paso 5.
        api_key: Clave transitoria de OpenAI para la corrección de subtítulos con
            IA (spec subtitulos-ia-remotion, Req 2.4, 1.2). Canal de propagación
            que el :class:`~app.jobs.runner.JobRunner` rellena con la clave que
            guarda el Gestor de Jobs. El sub-paso de IA (``corregir_grupos_ia``)
            que la consume se integra en el paso SUBTITULOS en la Tarea 4; aquí
            solo se recibe y se conserva sin registrarla en logs (nunca se loguea).
        reporter: Callback de progreso inyectable (Req 10.5).
        runner: Ejecutor de comandos externos inyectable.
        inspector: Inspector de clips (ffprobe) inyectable para el Paso 1.
        existe_salida: Predicado de existencia del subtitulado (Paso 4) inyectable.
        fn_unir/fn_cortar/fn_transcribir/fn_subtitulos/fn_musica/fn_preservar:
            Implementaciones de cada paso, inyectables para pruebas.

    Returns:
        :class:`ResultadoPipeline` con el resultado global.
    """
    job.create()

    resolucion = ajustes.generales.resolucion
    ancho = resolucion.ancho
    alto = resolucion.alto
    fps = ajustes.generales.fps

    hay_musica = musica_wav is not None and ajustes.musica is not None

    # -------------------- Paso 1: UNIR --------------------
    inicio, fin = RANGOS_PASOS[PipelineStep.UNIR]
    _reportar(reporter, JobStatus.EN_EJECUCION, 1, PipelineStep.UNIR, inicio,
              "Uniendo y normalizando clips a 9:16")
    # Solo se pasa ``transiciones`` a ``fn_unir`` cuando hay un efecto real
    # (tipo != "ninguna"); así el corte duro por defecto mantiene la firma previa
    # (compatibilidad con dobles de test que no aceptan el kwarg).
    unir_kwargs: Dict[str, Any] = {"runner": runner, "inspector": inspector}
    if ajustes.transiciones is not None and ajustes.transiciones.tipo != "ninguna":
        unir_kwargs["transiciones"] = ajustes.transiciones
    try:
        unido = fn_unir(job, orden_clips, ancho, alto, fps, **unir_kwargs)
    except Exception as exc:  # noqa: BLE001 - se traduce a fallo de Job (Req 10.7)
        return _fallo(reporter, 1, PipelineStep.UNIR, exc, inicio)
    _reportar(reporter, JobStatus.EN_EJECUCION, 1, PipelineStep.UNIR, fin,
              "Clips unidos")

    # -------------------- Paso 2: CORTAR_SILENCIOS --------------------
    inicio, fin = RANGOS_PASOS[PipelineStep.CORTAR_SILENCIOS]
    _reportar(reporter, JobStatus.EN_EJECUCION, 2, PipelineStep.CORTAR_SILENCIOS,
              inicio, "Cortando silencios")
    # Método de corte: "voz" usa el motor VAD (IA); "db" mantiene el motor por
    # defecto. Solo se pasa ``engine`` cuando es "voz", para no romper los dobles
    # de test que no aceptan el kwarg.
    cortar_kwargs: Dict[str, Any] = {
        "activado": ajustes.silencios.activado,
        "umbral_db": ajustes.silencios.umbral_db,
        "margen_ms": ajustes.silencios.margen_ms,
        "runner": runner,
    }
    if getattr(ajustes.silencios, "modo", "db") == "voz":
        cortar_kwargs["engine"] = "vad"
    try:
        cortado = fn_cortar(unido, job.resolve(NOMBRE_CORTADO), **cortar_kwargs)
    except SilenceProcessingError as exc:
        # Fail-soft OPCIONAL (VSE_SILENCE_FAILSOFT): si auto-editor falla, se
        # continúa el pipeline SIN recortar, usando el video de entrada del paso
        # (el unido) como si fuera el cortado. Solo aplica a este paso.
        if _silence_failsoft_activo():
            logger.warning(
                "Cortar silencios falló; se continúa sin recortar "
                "(%s): %s",
                ENV_SILENCE_FAILSOFT,
                exc,
            )
            cortado = unido
            _reportar(
                reporter,
                JobStatus.EN_EJECUCION,
                2,
                PipelineStep.CORTAR_SILENCIOS,
                fin,
                "Corte de silencios omitido tras fallo (fail-soft)",
            )
        else:
            # Comportamiento por defecto (Req 10.7): el Job pasa a fallido.
            return _fallo(reporter, 2, PipelineStep.CORTAR_SILENCIOS, exc, inicio)
    except Exception as exc:  # noqa: BLE001
        return _fallo(reporter, 2, PipelineStep.CORTAR_SILENCIOS, exc, inicio)
    else:
        _reportar(reporter, JobStatus.EN_EJECUCION, 2, PipelineStep.CORTAR_SILENCIOS,
                  fin, "Silencios recortados")

    # -------------------- Paso 3: TRANSCRIBIR --------------------
    inicio, fin = RANGOS_PASOS[PipelineStep.TRANSCRIBIR]
    _reportar(reporter, JobStatus.EN_EJECUCION, 3, PipelineStep.TRANSCRIBIR,
              inicio, "Transcribiendo audio")
    try:
        palabras = fn_transcribir(
            cortado, ajustes.transcripcion, job.resolve(NOMBRE_AUDIO), runner=runner
        )
    except Exception as exc:  # noqa: BLE001
        return _fallo(reporter, 3, PipelineStep.TRANSCRIBIR, exc, inicio)
    _reportar(reporter, JobStatus.EN_EJECUCION, 3, PipelineStep.TRANSCRIBIR,
              fin, "Transcripción completa")

    # -------------------- Quitar risas (opcional) --------------------
    # Tras transcribir, si está activado, se recortan los segmentos de risa del
    # video y se remapean los tiempos de las palabras a la nueva línea de tiempo.
    # Reasigna ``cortado`` (el video a subtitular) y ``palabras``.
    if getattr(ajustes, "risas", None) is not None and ajustes.risas.activado:
        _reportar(reporter, JobStatus.EN_EJECUCION, 3, PipelineStep.TRANSCRIBIR,
                  fin, "Quitando risas")
        try:
            cortado, palabras = fn_risas(
                cortado,
                job.resolve(NOMBRE_SIN_RISAS),
                palabras,
                margen_ms=ajustes.risas.margen_ms,
                runner=runner,
            )
        except Exception as exc:  # noqa: BLE001
            return _fallo(reporter, 3, PipelineStep.TRANSCRIBIR, exc, inicio)

    # -------------------- Pausa opcional: revisión manual de subtítulos -------
    # Si el usuario pidió revisar los subtítulos, el pipeline se detiene aquí
    # (tras la transcripción): agrupa las palabras y devuelve los grupos para que
    # se editen. La fase 2 (quemar subtítulos + música) se ejecuta al reanudar
    # con :func:`reanudar_pipeline`.
    if ajustes.subtitulos.revisar:
        grupos_revision = agrupar(palabras, ajustes.subtitulos.max_palabras)
        logger.info(
            "Pipeline en pausa para revisión manual de subtítulos (%d grupos)",
            len(grupos_revision),
        )
        return ResultadoPipeline(
            exito=False,
            pendiente_revision=True,
            cortado=Path(cortado),
            grupos=grupos_revision,
        )

    # -------------------- Parte A del paso SUBTITULOS: preparar y PAUSAR --------
    # En lugar de renderizar automáticamente con ASS (comportamiento previo), el
    # pipeline prepara los ``grupos_finales`` (agrupación + corrección IA
    # opcional, usando la ``api_key`` transitoria) y se **detiene** en
    # ESPERANDO_ELECCION_RENDER a la espera de que el usuario elija manualmente el
    # motor de render (spec subtitulos-ia-remotion, Req 6.1, 6.4). La **Parte B**
    # (render con EXACTAMENTE el motor elegido, sin fallback) la ejecuta la
    # reanudación (:func:`reanudar_pipeline`) que dispara ``POST /render/{id}``
    # (tarea 8). El Gestor de Jobs persiste esta pausa con
    # ``marcar_esperando_eleccion_render`` y NO limpia el workdir (los
    # intermedios se necesitan al reanudar el render).
    return preparar_grupos_y_pausar(
        cortado,
        ajustes,
        palabras=palabras,
        grupos=None,
        api_key=api_key,
        reporter=reporter,
    )


def preparar_grupos_y_pausar(
    cortado: Union[str, Path],
    ajustes: Ajustes,
    *,
    palabras: Optional[List[Any]] = None,
    grupos: Optional[List[GrupoSubtitulo]] = None,
    api_key: Optional[str] = None,
    reporter: ReporteProgreso = _reporter_noop,
    fn_agrupar: Callable[..., List[GrupoSubtitulo]] = agrupar,
    fn_corregir_ia: Callable[..., List[GrupoSubtitulo]] = corregir_grupos_ia,
) -> ResultadoPipeline:
    """Prepara los grupos finales de subtítulos y **pausa** para elegir el motor.

    Es la **Parte A** del paso 4 (SUBTITULOS) del pipeline extendido (spec
    subtitulos-ia-remotion, Req 1.2, 1.3, 6.1, 6.4): a partir del video
    ``cortado`` y de la transcripción/grupos, determina los ``grupos_finales`` y
    deja el Job a la espera de que el usuario elija manualmente el motor de render
    (dos botones en el frontend). **No renderiza** todavía: el render con el motor
    elegido (Parte B, sin fallback) y el endpoint de reanudación se implementan en
    las tareas 7 y 8.

    Comportamiento:

    1. **Grupos base** (Req 1.3): si se pasa ``grupos`` (p. ej. editados en la
       revisión manual) se usan tal cual; en caso contrario se agrupan las
       ``palabras`` con ``ajustes.subtitulos.max_palabras``.
    2. **Sub-paso IA opcional** (Req 1.2): se invoca ``corregir_grupos_ia`` con
       ``ajustes.revision_ia`` y la ``api_key`` transitoria. La corrección
       **degrada con gracia** internamente (ante clave ausente, IA desactivada o
       error de red devuelve los grupos originales); aun así, la llamada se
       envuelve defensivamente para garantizar que **nunca** pueda tumbar el
       pipeline: cualquier excepción inesperada cae a los grupos base.
    3. **Pausa** (Req 6.1): se devuelve un :class:`ResultadoPipeline` con
       ``pendiente_eleccion_render=True``, el video ``cortado`` y los
       ``grupos_finales``, **sin** renderizar ni conservar ningún vídeo. El Gestor
       de Jobs persistirá este estado con ``marcar_esperando_eleccion_render`` y
       el pipeline se reanudará (tarea 8) con el motor que elija el usuario.

    El progreso se reporta dentro del rango 70–90 % del paso SUBTITULOS de forma
    monótona no decreciente (Req 6.4): inicio en 70 % y, tras preparar los grupos,
    un valor intermedio del rango (sin alcanzar el 90 %, reservado para el render).

    Args:
        cortado: Ruta del video (silencios recortados) a subtitular al reanudar.
        ajustes: Conjunto completo de ajustes del pipeline.
        palabras: Palabras transcritas (para agrupar si ``grupos`` es ``None``).
        grupos: Grupos ya construidos/editados (opcional); tienen prioridad sobre
            ``palabras``.
        api_key: Clave transitoria de OpenAI para el sub-paso de IA (Req 2.4).
            Nunca se registra en logs.
        reporter: Callback de progreso inyectable (Req 6.4, 10.5).
        fn_agrupar: Implementación de la agrupación, inyectable para pruebas.
        fn_corregir_ia: Implementación de la corrección con IA, inyectable para
            pruebas.

    Returns:
        :class:`ResultadoPipeline` señalizando la pausa de elección de motor
        (``pendiente_eleccion_render=True``, ``exito=False``).
    """
    inicio, fin = RANGOS_PASOS[PipelineStep.SUBTITULOS]
    _reportar(reporter, JobStatus.EN_EJECUCION, 4, PipelineStep.SUBTITULOS, inicio,
              "Preparando grupos de subtítulos")

    # (1) Grupos base: los editados si vienen, si no la agrupación de palabras.
    if grupos is not None:
        grupos_base: List[GrupoSubtitulo] = list(grupos)
    else:
        grupos_base = fn_agrupar(
            palabras if palabras is not None else [],
            ajustes.subtitulos.max_palabras,
        )

    # Valor intermedio del rango (70–90) para el sub-paso de IA, sin alcanzar el
    # 90 % que queda reservado para la finalización del render (Req 6.4).
    medio = inicio + (fin - inicio) // 2
    _reportar(reporter, JobStatus.EN_EJECUCION, 4, PipelineStep.SUBTITULOS, medio,
              "Corrigiendo subtítulos con IA (opcional)")

    # (2) Sub-paso IA opcional. ``corregir_grupos_ia`` degrada con gracia por
    # diseño; el try/except es una salvaguarda extra para que ESTE sub-paso NUNCA
    # pueda tumbar el pipeline (Req 1.2, 5.3).
    try:
        grupos_finales = fn_corregir_ia(
            grupos_base,
            ajustes.revision_ia,
            api_key,
            minusculas=ajustes.subtitulos.minusculas,
        )
    except Exception:  # noqa: BLE001 - la IA nunca debe tumbar el pipeline (Req 5.3)
        logger.warning(
            "Sub-paso de corrección IA degradado por excepción inesperada; "
            "se usan los grupos sin corregir"
        )
        grupos_finales = grupos_base

    # (3) PAUSA: elección manual del motor. No se renderiza ni se conserva nada.
    _reportar(reporter, JobStatus.EN_EJECUCION, 4, PipelineStep.SUBTITULOS, medio,
              "Grupos listos; esperando elección del motor de render")
    logger.info(
        "Pipeline en pausa para elección del motor de render (%d grupos)",
        len(grupos_finales),
    )
    return ResultadoPipeline(
        exito=False,
        pendiente_eleccion_render=True,
        cortado=Path(cortado),
        grupos=list(grupos_finales),
    )


def renderizar_con_motor_elegido(
    job: JobWorkdir,
    cortado: Union[str, Path],
    ajustes: Ajustes,
    motor: MotorRender = DEFAULT_MOTOR_RENDER,
    *,
    palabras: Optional[List[Any]] = None,
    grupos: Optional[List[GrupoSubtitulo]] = None,
    runner: Runner = ejecutar_comando,
    existe_salida: Optional[Callable[[Path], bool]] = None,
    fn_subtitulos: Callable[..., Path] = generar_y_quemar_subtitulos,
    fn_remotion: Callable[..., Path] = renderizar_con_remotion,
) -> Path:
    """Renderiza el paso SUBTITULOS con **exactamente** el motor elegido (Req 7.1-7.3, 13.1).

    Es la **Parte B** del paso 4 (SUBTITULOS) del pipeline extendido (spec
    subtitulos-ia-remotion): despacha el render al motor que el usuario eligió
    manualmente (dos botones en el frontend) y ejecuta **solo** ese motor, sin
    ningún ``try``/fallback entre motores (Propiedad 8, Req 7.1, 7.2, 7.3):

    * ``motor == "remotion"`` → :func:`~app.engine.remotion.renderizar_con_remotion`
      escribiendo ``props.json`` (:data:`NOMBRE_PROPS_JSON`) y el MP4
      (:data:`NOMBRE_REMOTION_MP4`) dentro del ``JobWorkdir``. Un
      :class:`~app.engine.remotion.RemotionError` se **propaga** (sin fallback al
      quemado ASS): lo maneja el llamador para marcar el Job FALLIDO (Req 7.4).
    * ``motor == "ass"`` → :func:`~app.engine.subtitles.generar_y_quemar_subtitulos`
      con los ``grupos`` ya definitivos, igual que el flujo actual de
      :func:`reanudar_pipeline`.

    El motor se **valida** contra :data:`_MOTORES_VALIDOS` (``{"ass", "remotion"}``)
    antes de despachar; un valor distinto es un error de programación (el endpoint
    de la tarea 8 rechaza los motores inválidos con ``400`` antes de llegar aquí).

    Compatibilidad hacia atrás: en el flujo normal/ASS se conserva la firma previa
    del paso de subtítulos (se pasa ``grupos`` **solo** cuando hay grupos ya
    construidos y se reenvían las ``palabras`` en caso contrario), de modo que los
    dobles de test existentes siguen funcionando.

    Args:
        job: Directorio de trabajo del Job (contención de ``props.json``/MP4).
        cortado: Ruta del video (silencios recortados) a renderizar. Inmutable
            (la salida es un archivo distinto, Req 13.1).
        ajustes: Conjunto completo de ajustes (subtítulos, resolución, fps, render).
        motor: Motor de render elegido por el usuario (``"ass"`` | ``"remotion"``).
        palabras: Palabras transcritas (para agrupar si ``grupos`` es ``None``).
        grupos: Grupos de subtítulo ya construidos/editados (opcional).
        runner: Ejecutor de comandos externos inyectable.
        existe_salida: Predicado de existencia del artefacto de salida inyectable.
        fn_subtitulos: Implementación del quemado ASS, inyectable para pruebas.
        fn_remotion: Implementación del render Remotion, inyectable para pruebas.

    Returns:
        La ruta del video renderizado (subtitulado ASS o MP4 de Remotion).

    Raises:
        ValueError: Si ``motor`` no pertenece a :data:`_MOTORES_VALIDOS`.
        RemotionError: Si el render con Remotion falla (se propaga, sin fallback).
        SubtitulosError / ConfiguracionSubtitulosError: Si el quemado ASS falla.
    """
    # Validación defensiva del motor (Req 7.1). El endpoint POST /render/{id}
    # (tarea 8) ya rechaza motores inválidos con 400; aquí es una salvaguarda.
    if motor not in _MOTORES_VALIDOS:
        raise ValueError(
            f"Motor de render no válido: {motor!r} "
            f"(se esperaba uno de {_MOTORES_VALIDOS})"
        )

    resolucion = ajustes.generales.resolucion
    cortado_path = Path(cortado)

    if motor == "remotion":
        # Sin try/fallback: un RemotionError se propaga y el Job pasa a FALLIDO
        # (Req 7.4). Remotion necesita grupos concretos; si no vienen ya
        # preparados, se agrupan las palabras como en el flujo ASS.
        grupos_render = (
            grupos
            if grupos is not None
            else agrupar(
                palabras if palabras is not None else [],
                ajustes.subtitulos.max_palabras,
            )
        )
        return fn_remotion(
            cortado_path,
            grupos_render,
            ajustes.subtitulos,
            resolucion,
            ajustes.generales.fps,
            job.resolve(NOMBRE_PROPS_JSON),
            job.resolve(NOMBRE_REMOTION_MP4),
            runner=runner,
            existe_salida=existe_salida,
            combine_tokens_ms=ajustes.render.combine_tokens_ms,
        )

    # motor == "ass": quemado ASS con ffmpeg/libass (comportamiento previo).
    sub_kwargs: Dict[str, Any] = {"runner": runner, "existe_salida": existe_salida}
    if grupos is not None:
        sub_kwargs["grupos"] = grupos
    return fn_subtitulos(
        cortado_path,
        palabras if palabras is not None else [],
        ajustes.subtitulos,
        resolucion,
        job.resolve(NOMBRE_ASS),
        job.resolve(NOMBRE_SUBTITULADO),
        **sub_kwargs,
    )


def _limpiar_artefactos_remotion(
    job: JobWorkdir, existe_salida: Optional[Callable[[Path], bool]] = None
) -> None:
    """Elimina ``props.json`` y el MP4 de Remotion del workdir tras un fallo (Req 13.2, 13.3).

    Se invoca cuando el motor Remotion falla y el Job pasa a FALLIDO: no debe
    quedar referenciado ningún artefacto parcial. El ``Video_Final`` se conserva
    aparte (fuera del workdir) y no se toca aquí. La limpieza completa del workdir
    la realiza además el :class:`~app.jobs.runner.JobRunner` al terminar el Job;
    esta limpieza es una salvaguarda explícita. Un fallo al eliminar no debe
    propagar ni enmascarar el error original del render.
    """
    comprobar = existe_salida if existe_salida is not None else (lambda p: p.exists())
    for nombre in (NOMBRE_PROPS_JSON, NOMBRE_REMOTION_MP4):
        try:
            ruta = job.resolve(nombre)
        except Exception:  # noqa: BLE001 - la limpieza nunca debe propagar
            continue
        try:
            if comprobar(ruta):
                os.remove(ruta)
        except OSError:
            logger.warning(
                "No se pudo eliminar el artefacto de Remotion %s del Job %s",
                ruta,
                job.job_id,
            )


def reanudar_pipeline(
    job: JobWorkdir,
    cortado: Union[str, Path],
    ajustes: Ajustes,
    *,
    palabras: Optional[List[Any]] = None,
    grupos: Optional[List[GrupoSubtitulo]] = None,
    motor: MotorRender = DEFAULT_MOTOR_RENDER,
    musica_wav: Optional[str] = None,
    reporter: ReporteProgreso = _reporter_noop,
    runner: Runner = ejecutar_comando,
    fn_subtitulos: Callable[..., Path] = generar_y_quemar_subtitulos,
    fn_remotion: Callable[..., Path] = renderizar_con_remotion,
    fn_musica: Callable[..., Path] = mezclar_musica,
    fn_preservar: Callable[[JobWorkdir, Any], Path] = preservar_video_final,
    existe_salida: Optional[Callable[[Path], bool]] = None,
    **_inyecciones_ignoradas: Any,
) -> ResultadoPipeline:
    """Ejecuta la **fase 2** del pipeline: subtítulos, música y conservación.

    Es la continuación de :func:`ejecutar_pipeline` a partir del video ya
    ``cortado`` (silencios recortados) y la transcripción. Se usa en dos casos:

    * Flujo normal (sin revisión): lo invoca :func:`ejecutar_pipeline` con
      ``grupos=None`` y las ``palabras`` transcritas (la agrupación la hace el
      paso de subtítulos).
    * Reanudación tras la **revisión manual**: lo invoca el Gestor de Jobs con
      los ``grupos`` ya editados por el usuario (``palabras`` puede ir vacío).
    * Reanudación tras la **elección de motor** (spec subtitulos-ia-remotion,
      tarea 8): lo invoca el Gestor de Jobs con los ``grupos`` finales y el
      ``motor`` que el usuario eligió (``"ass"`` | ``"remotion"``).

    El render del paso SUBTITULOS se delega en :func:`renderizar_con_motor_elegido`,
    que ejecuta **exactamente** el motor indicado por ``motor`` **sin fallback**
    (Req 7.1-7.4). Por compatibilidad hacia atrás ``motor`` es ``"ass"`` por
    defecto, de modo que el flujo normal y la reanudación de la revisión manual
    (y sus tests) se comportan igual que antes.

    Reporta el progreso desde el paso SUBTITULOS (70 %) hasta el 100 % y respeta
    el modo fail-soft de subtítulos (``VSE_SUBTITLES_FAILSOFT``, solo para el
    quemado ASS). Acepta y **ignora** inyecciones de pasos de la fase 1
    (``fn_unir``, etc.) para poder reenviar el mismo conjunto de inyecciones del
    Gestor de Jobs.

    Manejo de fallo del render (Req 7.4, 13.2, 13.3): si el motor elegido falla
    (``RemotionError`` en Remotion, o ``SubtitulosError`` en ASS sin fail-soft),
    el Job pasa a ``FALLIDO`` con ``error = {"paso": "SUBTITULOS", "motivo": ...}``
    **sin** reintentar el otro motor. En el caso Remotion, además, se limpian
    ``props.json`` y el MP4 parcial para no dejar artefactos referenciados.

    Args:
        job: Directorio de trabajo del Job.
        cortado: Ruta del video (silencios recortados) a subtitular.
        ajustes: Conjunto completo de ajustes.
        palabras: Palabras transcritas (para agrupar si ``grupos`` es ``None``).
        grupos: Grupos de subtítulo ya construidos/editados (opcional).
        motor: Motor de render elegido (``"ass"`` por defecto; ``"remotion"`` para
            el render programático). Ver :func:`renderizar_con_motor_elegido`.
        musica_wav: Ruta del WAV de música, o ``None`` para omitir el paso 5.
        reporter: Callback de progreso inyectable (Req 10.5).
        runner: Ejecutor de comandos externos inyectable.
        fn_subtitulos/fn_remotion/fn_musica/fn_preservar: Implementaciones
            inyectables (quemado ASS, render Remotion, música y conservación).
        existe_salida: Predicado de existencia del subtitulado inyectable.

    Returns:
        :class:`ResultadoPipeline` con el resultado de la fase 2.
    """
    resolucion = ajustes.generales.resolucion
    hay_musica = musica_wav is not None and ajustes.musica is not None
    palabras_seq: List[Any] = palabras if palabras is not None else []
    cortado_path = Path(cortado)

    # -------------------- Paso 4: SUBTITULOS --------------------
    inicio, fin = RANGOS_PASOS[PipelineStep.SUBTITULOS]
    mensaje_inicio = (
        "Renderizando subtítulos con Remotion"
        if motor == "remotion"
        else "Generando y quemando subtítulos"
    )
    _reportar(reporter, JobStatus.EN_EJECUCION, 4, PipelineStep.SUBTITULOS,
              inicio, mensaje_inicio)
    # El render se delega en ``renderizar_con_motor_elegido``, que ejecuta
    # EXACTAMENTE el motor elegido, sin fallback entre motores (Req 7.1-7.3).
    try:
        subtitulado = renderizar_con_motor_elegido(
            job,
            cortado_path,
            ajustes,
            motor,
            palabras=palabras_seq,
            grupos=grupos,
            runner=runner,
            existe_salida=existe_salida,
            fn_subtitulos=fn_subtitulos,
            fn_remotion=fn_remotion,
        )
    except RemotionError as exc:
        # Motor Remotion fallido: SIN fallback al ASS (Req 7.4). El Job pasa a
        # FALLIDO con error accionable {"paso": "SUBTITULOS", "motivo": ...} y se
        # limpian props.json y el MP4 parcial de Remotion (Req 13.2, 13.3),
        # conservando el Video_Final (que aún no existe en este punto de fallo).
        _limpiar_artefactos_remotion(job, existe_salida)
        return _fallo(reporter, 4, PipelineStep.SUBTITULOS, exc, inicio)
    except (SubtitulosError, ConfiguracionSubtitulosError) as exc:
        # Fail-soft OPCIONAL (VSE_SUBTITLES_FAILSOFT): si el quemado ASS falla, se
        # continúa el pipeline SIN subtítulos, usando el video de entrada del paso
        # (el cortado) como salida. Solo aplica al motor ASS. NO hay fail-soft
        # para Remotion: su fallo siempre pasa el Job a FALLIDO (sin fallback).
        if _subtitles_failsoft_activo():
            logger.warning(
                "Subtítulos fallaron; se continúa sin subtítulos (%s): %s",
                ENV_SUBTITLES_FAILSOFT,
                exc,
            )
            subtitulado = cortado_path
            _reportar(
                reporter,
                JobStatus.EN_EJECUCION,
                4,
                PipelineStep.SUBTITULOS,
                fin,
                "Subtítulos omitidos tras fallo (fail-soft)",
            )
        else:
            # Comportamiento por defecto (Req 10.7): el Job pasa a fallido.
            return _fallo(reporter, 4, PipelineStep.SUBTITULOS, exc, inicio)
    except Exception as exc:  # noqa: BLE001
        return _fallo(reporter, 4, PipelineStep.SUBTITULOS, exc, inicio)
    else:
        mensaje_fin = (
            "Subtítulos renderizados con Remotion"
            if motor == "remotion"
            else "Subtítulos quemados"
        )
        _reportar(reporter, JobStatus.EN_EJECUCION, 4, PipelineStep.SUBTITULOS,
                  fin, mensaje_fin)

    # -------------------- Paso 5: MUSICA (opcional) --------------------
    video_final_tmp = subtitulado
    if hay_musica:
        inicio, fin = RANGOS_PASOS[PipelineStep.MUSICA]
        _reportar(reporter, JobStatus.EN_EJECUCION, 5, PipelineStep.MUSICA,
                  inicio, "Mezclando música de fondo")
        try:
            video_final_tmp = fn_musica(
                subtitulado,
                musica_wav,
                ajustes.musica,
                job.resolve(NOMBRE_FINAL),
                runner=runner,
            )
        except Exception as exc:  # noqa: BLE001
            return _fallo(reporter, 5, PipelineStep.MUSICA, exc, inicio)
    else:
        logger.info("Paso MUSICA omitido: no se proporcionó un WAV válido (Req 8.3)")

    # -------------------- Conservación del Video_Final --------------------
    try:
        ruta_final = fn_preservar(job, video_final_tmp)
    except Exception as exc:  # noqa: BLE001 - fallo al conservar => Job fallido
        paso_final = PipelineStep.MUSICA if hay_musica else PipelineStep.SUBTITULOS
        indice_final = 5 if hay_musica else 4
        return _fallo(reporter, indice_final, paso_final, exc,
                      RANGOS_PASOS[paso_final][1])

    # Evento final de éxito: 100 % y estado COMPLETADO (Req 10.5).
    _reportar(
        reporter,
        JobStatus.COMPLETADO,
        TOTAL_PASOS,
        PipelineStep.MUSICA if hay_musica else PipelineStep.SUBTITULOS,
        100,
        "Procesamiento completado",
    )
    return ResultadoPipeline(exito=True, ruta_video_final=ruta_final)


def _reportar(
    reporter: ReporteProgreso,
    estado: JobStatus,
    indice_paso: int,
    paso: Optional[PipelineStep],
    porcentaje: int,
    mensaje: str,
) -> None:
    """Emite un evento de progreso hacia el ``reporter`` (sin error)."""
    reporter(
        EventoProgreso(
            estado=estado,
            indice_paso=indice_paso,
            paso_actual=paso,
            porcentaje=porcentaje,
            mensaje=mensaje,
        )
    )


def _fallo(
    reporter: ReporteProgreso,
    indice_paso: int,
    paso: PipelineStep,
    exc: BaseException,
    porcentaje: int,
) -> ResultadoPipeline:
    """Reporta un evento ``FALLIDO`` y devuelve un resultado sin éxito (Req 10.7).

    El evento incluye ``error = {"paso": <paso>, "motivo": <motivo>}`` para que
    el Gestor de Jobs lo exponga en ``GET /progreso`` (Req 10.7).
    """
    motivo = str(exc)
    logger.warning("Paso %s falló: %s", paso.value, motivo)
    reporter(
        EventoProgreso(
            estado=JobStatus.FALLIDO,
            indice_paso=indice_paso,
            paso_actual=paso,
            porcentaje=porcentaje,
            mensaje=f"Falló el paso {paso.value}",
            error={"paso": paso.value, "motivo": motivo},
        )
    )
    return ResultadoPipeline(exito=False, paso_fallido=paso, motivo=motivo)


__all__ = [
    "RANGOS_PASOS",
    "ORDEN_PASOS",
    "ENV_SILENCE_FAILSOFT",
    "ENV_SUBTITLES_FAILSOFT",
    "EventoProgreso",
    "ReporteProgreso",
    "ResultadoPipeline",
    "ejecutar_pipeline",
    "preparar_grupos_y_pausar",
    "renderizar_con_motor_elegido",
    "reanudar_pipeline",
]
