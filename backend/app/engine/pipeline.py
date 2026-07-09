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
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from app.engine.ffprobe import inspeccionar_clip
from app.engine.music import NOMBRE_FINAL, mezclar_musica
from app.engine.normalize import unir_clips
from app.engine.proc import Runner, ejecutar_comando
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
from app.engine.transcribe import NOMBRE_AUDIO, transcribir
from app.models.job import JobStatus, PipelineStep, TOTAL_PASOS
from app.models.settings import Ajustes
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


def ejecutar_pipeline(
    job: JobWorkdir,
    orden_clips: Sequence[str],
    ajustes: Ajustes,
    *,
    musica_wav: Optional[str] = None,
    reporter: ReporteProgreso = _reporter_noop,
    runner: Runner = ejecutar_comando,
    inspector: Callable[[str], Any] = inspeccionar_clip,
    existe_salida: Optional[Callable[[Path], bool]] = None,
    # Pasos inyectables (por defecto, las implementaciones reales del motor).
    fn_unir: Callable[..., Path] = unir_clips,
    fn_cortar: Callable[..., Path] = cortar_silencios,
    fn_transcribir: Callable[..., List[Any]] = transcribir,
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
    try:
        unido = fn_unir(
            job, orden_clips, ancho, alto, fps, runner=runner, inspector=inspector
        )
    except Exception as exc:  # noqa: BLE001 - se traduce a fallo de Job (Req 10.7)
        return _fallo(reporter, 1, PipelineStep.UNIR, exc, inicio)
    _reportar(reporter, JobStatus.EN_EJECUCION, 1, PipelineStep.UNIR, fin,
              "Clips unidos")

    # -------------------- Paso 2: CORTAR_SILENCIOS --------------------
    inicio, fin = RANGOS_PASOS[PipelineStep.CORTAR_SILENCIOS]
    _reportar(reporter, JobStatus.EN_EJECUCION, 2, PipelineStep.CORTAR_SILENCIOS,
              inicio, "Cortando silencios")
    try:
        cortado = fn_cortar(
            unido,
            job.resolve(NOMBRE_CORTADO),
            activado=ajustes.silencios.activado,
            umbral_db=ajustes.silencios.umbral_db,
            margen_ms=ajustes.silencios.margen_ms,
            runner=runner,
        )
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

    # -------------------- Paso 4: SUBTITULOS --------------------
    inicio, fin = RANGOS_PASOS[PipelineStep.SUBTITULOS]
    _reportar(reporter, JobStatus.EN_EJECUCION, 4, PipelineStep.SUBTITULOS,
              inicio, "Generando y quemando subtítulos")
    try:
        subtitulado = fn_subtitulos(
            cortado,
            palabras,
            ajustes.subtitulos,
            resolucion,
            job.resolve(NOMBRE_ASS),
            job.resolve(NOMBRE_SUBTITULADO),
            runner=runner,
            existe_salida=existe_salida,
        )
    except (SubtitulosError, ConfiguracionSubtitulosError) as exc:
        # Fail-soft OPCIONAL (VSE_SUBTITLES_FAILSOFT): si el quemado de subtítulos
        # falla, se continúa el pipeline SIN subtítulos, usando el video de
        # entrada del paso (el cortado) como salida. Solo aplica a este paso.
        if _subtitles_failsoft_activo():
            logger.warning(
                "Subtítulos fallaron; se continúa sin subtítulos (%s): %s",
                ENV_SUBTITLES_FAILSOFT,
                exc,
            )
            subtitulado = cortado
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
        _reportar(reporter, JobStatus.EN_EJECUCION, 4, PipelineStep.SUBTITULOS,
                  fin, "Subtítulos quemados")

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
]
