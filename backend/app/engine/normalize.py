"""Cálculos puros de normalización 9:16 y orden de concatenación (Paso 1).

Implementa la **lógica pura** del Paso 1 del pipeline (UNIR, Req 3): la
matemática de escala + relleno (letterbox) para encajar clips heterogéneos en la
``Resolución_Objetivo`` sin deformar, la construcción del filtro de ffmpeg
correspondiente y la construcción de la lista de concatenación (``concat.txt``)
que preserva exactamente el ``Orden_de_Clips`` recibido.

Este módulo es **determinista y sin efectos**: no invoca ``ffmpeg``/``ffprobe``
ni realiza E/S. La ejecución real (normalizar cada clip a un intermedio y
concatenar con el demuxer ``concat``) pertenece a la tarea 11.2, que reutilizará
estas funciones para construir sus comandos.

Garantías (Propiedades 5, 6 y 7 del diseño):

* **Propiedad 6 — Normalización sin deformación:** el factor de escala es
  ``s = min(W/w, H/h)`` (idéntico en ambos ejes, por lo que se conserva la
  relación de aspecto), las dimensiones escaladas no exceden el objetivo
  (``w·s <= W`` y ``h·s <= H``) y el relleno por lado es no negativo y centrado
  (``padX = (W - w·s)/2 >= 0``, ``padY = (H - h·s)/2 >= 0``) (Req 3.1).
* **Propiedad 7 — Homogeneización:** tras planificar la normalización de clips
  heterogéneos, todos los intermedios comparten idéntica resolución objetivo
  ``(W, H)`` e idénticos ``Cuadros_Por_Segundo_Objetivo`` (Req 3.3).
* **Propiedad 5 — Preservación del orden:** el contenido de ``concat.txt`` es
  igual, elemento a elemento, al ``Orden_de_Clips`` recibido; nunca reordena,
  omite ni duplica clips (Req 2.4, 3.4).

Referencias de requisitos: 3.1, 3.3, 3.4, 2.4.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Sequence

from app import config

# ---------------------------------------------------------------------------
# Rango de dimensiones válidas (Req 3.2): cada eje es un entero entre 2 y 7680.
# ---------------------------------------------------------------------------
MIN_DIMENSION: int = 2
MAX_DIMENSION: int = 7680


def _validar_dimension(nombre: str, valor: int) -> int:
    """Valida que una dimensión sea un entero estrictamente positivo.

    Las dimensiones no positivas no tienen sentido físico y provocarían una
    división por cero al calcular el factor de escala.

    Raises:
        ValueError: Si ``valor`` no es un entero positivo.
    """
    try:
        entero = int(valor)
    except (TypeError, ValueError) as exc:
        raise ValueError("%s debe ser un entero, se recibió %r" % (nombre, valor)) from exc
    if entero <= 0:
        raise ValueError("%s debe ser positivo, se recibió %r" % (nombre, valor))
    return entero


def factor_escala(ancho: int, alto: int, ancho_objetivo: int, alto_objetivo: int) -> float:
    """Devuelve el factor de escala ``s = min(W/w, H/h)`` (Req 3.1).

    Al usar el mismo factor para ambos ejes se conserva la relación de aspecto
    original (sin deformación) y se garantiza que el contenido escalado cabe
    completo dentro de la ``Resolución_Objetivo``.

    Args:
        ancho: Ancho de origen ``w`` (píxeles, > 0).
        alto: Alto de origen ``h`` (píxeles, > 0).
        ancho_objetivo: Ancho objetivo ``W`` (píxeles, > 0).
        alto_objetivo: Alto objetivo ``H`` (píxeles, > 0).

    Returns:
        El factor de escala común a ambos ejes.
    """
    w = _validar_dimension("ancho", ancho)
    h = _validar_dimension("alto", alto)
    W = _validar_dimension("ancho_objetivo", ancho_objetivo)
    H = _validar_dimension("alto_objetivo", alto_objetivo)
    return min(W / w, H / h)


@dataclass(frozen=True)
class PlanNormalizacion:
    """Plan puro de normalización de un clip a la ``Resolución_Objetivo``.

    Reúne el resultado de la matemática de escala + relleno para un clip y la
    cadena de filtro de ffmpeg equivalente. Es inmutable (``frozen``) porque
    describe un cálculo determinista sin estado.

    Atributos:
        ancho_origen / alto_origen: dimensiones del clip de entrada ``(w, h)``.
        ancho_objetivo / alto_objetivo: resolución objetivo ``(W, H)``.
        fps_objetivo: cuadros por segundo objetivo.
        factor_escala: ``s = min(W/w, H/h)`` (idéntico en ambos ejes).
        ancho_escalado / alto_escalado: dimensiones tras aplicar ``s`` (``w·s``, ``h·s``).
        pad_x / pad_y: relleno por lado (barras negras), no negativo y centrado.
        filtro: cadena de filtro de ffmpeg (``scale=...,pad=...,setsar=1,fps=...``).
    """

    ancho_origen: int
    alto_origen: int
    ancho_objetivo: int
    alto_objetivo: int
    fps_objetivo: int
    factor_escala: float
    ancho_escalado: float
    alto_escalado: float
    pad_x: float
    pad_y: float
    filtro: str


def cadena_filtro_normalizacion(
    ancho_objetivo: int, alto_objetivo: int, fps: int
) -> str:
    """Construye la cadena de filtro de normalización de ffmpeg (Req 3.1, 3.3).

    Produce exactamente (sin ejecutar ffmpeg)::

        scale=w=W:h=H:force_original_aspect_ratio=decrease,\
pad=W:H:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=FPS

    * ``force_original_aspect_ratio=decrease`` encaja el contenido completo
      conservando la relación de aspecto (sin recorte ni deformación) (Req 3.1).
    * ``pad ...:(ow-iw)/2:(oh-ih)/2:color=black`` centra el contenido y rellena
      con barras negras (Req 3.1).
    * ``setsar=1`` evita deformación por relación de aspecto de píxel.
    * ``fps=FPS`` normaliza a ``Cuadros_Por_Segundo_Objetivo`` (Req 3.3, 3.5).

    Args:
        ancho_objetivo: Ancho objetivo ``W`` (píxeles, > 0).
        alto_objetivo: Alto objetivo ``H`` (píxeles, > 0).
        fps: Cuadros por segundo objetivo (> 0).

    Returns:
        La cadena de filtro ``-vf`` como valor computado.
    """
    W = _validar_dimension("ancho_objetivo", ancho_objetivo)
    H = _validar_dimension("alto_objetivo", alto_objetivo)
    fps_val = _validar_dimension("fps", fps)
    return (
        "scale=w=%d:h=%d:force_original_aspect_ratio=decrease,"
        "pad=%d:%d:(ow-iw)/2:(oh-ih)/2:color=black,"
        "setsar=1,fps=%d" % (W, H, W, H, fps_val)
    )


def plan_normalizacion(
    ancho: int,
    alto: int,
    ancho_objetivo: int,
    alto_objetivo: int,
    fps: int,
) -> PlanNormalizacion:
    """Calcula el plan de normalización (escala + pad + filtro) de un clip.

    Args:
        ancho: Ancho de origen ``w`` (píxeles, > 0).
        alto: Alto de origen ``h`` (píxeles, > 0).
        ancho_objetivo: Ancho objetivo ``W`` (píxeles, > 0).
        alto_objetivo: Alto objetivo ``H`` (píxeles, > 0).
        fps: Cuadros por segundo objetivo (> 0).

    Returns:
        Un :class:`PlanNormalizacion` con el factor de escala, las dimensiones
        escaladas, el relleno centrado y la cadena de filtro.
    """
    w = _validar_dimension("ancho", ancho)
    h = _validar_dimension("alto", alto)
    W = _validar_dimension("ancho_objetivo", ancho_objetivo)
    H = _validar_dimension("alto_objetivo", alto_objetivo)
    fps_val = _validar_dimension("fps", fps)

    s = min(W / w, H / h)
    ancho_escalado = w * s
    alto_escalado = h * s
    # Relleno centrado por lado (Req 3.1). Es no negativo porque `s <= W/w` y
    # `s <= H/h` implican `w·s <= W` y `h·s <= H`.
    pad_x = (W - ancho_escalado) / 2.0
    pad_y = (H - alto_escalado) / 2.0

    return PlanNormalizacion(
        ancho_origen=w,
        alto_origen=h,
        ancho_objetivo=W,
        alto_objetivo=H,
        fps_objetivo=fps_val,
        factor_escala=s,
        ancho_escalado=ancho_escalado,
        alto_escalado=alto_escalado,
        pad_x=pad_x,
        pad_y=pad_y,
        filtro=cadena_filtro_normalizacion(W, H, fps_val),
    )


def planificar_clips(
    dimensiones: Sequence[Sequence[int]],
    ancho_objetivo: int,
    alto_objetivo: int,
    fps: int,
) -> List[PlanNormalizacion]:
    """Planifica la normalización de un conjunto de clips heterogéneos (Req 3.3).

    Cada clip (con su ``(w, h)`` propio) se planifica hacia la **misma**
    resolución objetivo ``(W, H)`` y los mismos ``fps``, condición necesaria para
    concatenar sin fallar (Propiedad 7).

    Args:
        dimensiones: Secuencia de pares ``(ancho, alto)`` de cada clip de entrada.
        ancho_objetivo: Ancho objetivo ``W`` compartido.
        alto_objetivo: Alto objetivo ``H`` compartido.
        fps: Cuadros por segundo objetivo compartido.

    Returns:
        Lista de :class:`PlanNormalizacion`, uno por clip, en el mismo orden.
    """
    planes: List[PlanNormalizacion] = []
    for par in dimensiones:
        w, h = par[0], par[1]
        planes.append(plan_normalizacion(w, h, ancho_objetivo, alto_objetivo, fps))
    return planes


# ---------------------------------------------------------------------------
# Lista de concatenación (concat.txt) — preservación del orden (Propiedad 5)
# ---------------------------------------------------------------------------
def orden_concatenacion(orden_clips: Sequence[str]) -> List[str]:
    """Devuelve la secuencia de concatenación igual, elemento a elemento, al orden recibido.

    Es una copia fiel del ``Orden_de_Clips``: no reordena, no omite ni duplica
    elementos. Se expone como función explícita para dejar patente que el motor
    respeta el orden del usuario en la concatenación (Req 2.4, 3.4).

    Args:
        orden_clips: Secuencia de referencias de clip (ids o rutas) en el orden
            definido por el usuario.

    Returns:
        Una nueva lista con los mismos elementos y en el mismo orden.
    """
    return list(orden_clips)


def _escape_concat(referencia: str) -> str:
    """Escapa una referencia para una línea ``file '...'`` del demuxer concat.

    El demuxer ``concat`` de ffmpeg delimita las rutas con comillas simples; una
    comilla simple dentro de la ruta se representa cerrando la comilla, insertando
    una comilla simple escapada y reabriendo: ``'\\''``.
    """
    return referencia.replace("'", "'\\''")


def _unescape_concat(referencia: str) -> str:
    """Operación inversa de :func:`_escape_concat`."""
    return referencia.replace("'\\''", "'")


def contenido_concat_txt(orden_clips: Sequence[str]) -> str:
    """Construye el contenido de ``concat.txt`` a partir del ``Orden_de_Clips`` (Req 3.4).

    Emite una línea ``file '<referencia>'`` por clip, en el orden exacto recibido,
    lista para el demuxer ``concat`` de ffmpeg
    (``ffmpeg -f concat -safe 0 -i concat.txt ...``).

    Args:
        orden_clips: Secuencia de referencias de clip (rutas o ids) en orden.

    Returns:
        El contenido textual de ``concat.txt`` (una línea por clip).
    """
    lineas = ["file '%s'" % _escape_concat(ref) for ref in orden_concatenacion(orden_clips)]
    return "\n".join(lineas) + ("\n" if lineas else "")


def parsear_concat_txt(contenido: str) -> List[str]:
    """Recupera la lista de referencias desde el contenido de un ``concat.txt``.

    Operación inversa de :func:`contenido_concat_txt`; permite verificar el
    round-trip y la preservación del orden (Propiedad 5).

    Args:
        contenido: Texto de un archivo ``concat.txt``.

    Returns:
        La lista de referencias de clip, en el mismo orden que aparecen.
    """
    referencias: List[str] = []
    for linea in contenido.splitlines():
        texto = linea.strip()
        if not texto or not texto.startswith("file "):
            continue
        resto = texto[len("file ") :].strip()
        if len(resto) >= 2 and resto[0] == "'" and resto[-1] == "'":
            resto = resto[1:-1]
        referencias.append(_unescape_concat(resto))
    return referencias


__all__ = [
    "MIN_DIMENSION",
    "MAX_DIMENSION",
    "factor_escala",
    "PlanNormalizacion",
    "cadena_filtro_normalizacion",
    "plan_normalizacion",
    "planificar_clips",
    "orden_concatenacion",
    "contenido_concat_txt",
    "parsear_concat_txt",
]



# ===========================================================================
# TAREA 11.2 — Ejecución del Paso 1 (UNIR): normalizar cada clip a un
# intermedio con parámetros idénticos y concatenar en el orden del usuario.
#
# Esta sección añade la parte con **efectos** (invoca ffmpeg/ffprobe) sobre la
# lógica pura anterior, sin modificarla. Toda la ejecución externa pasa por un
# ``Runner`` inyectable (por defecto subprocess), de modo que los tests puedan
# simular éxitos/fallos sin depender de los binarios reales.
#
# Referencias de requisitos: 3.1, 3.3, 3.4, 3.6.
# ===========================================================================

from pathlib import Path as _Path  # noqa: E402  (import diferido de la sección de ejecución)
from typing import Callable as _Callable, Optional as _Optional  # noqa: E402

from app.engine.ffprobe import (  # noqa: E402
    ClipInfo,
    ClipInspeccionError,
    inspeccionar_clip,
)
from app.engine.proc import Runner, ejecutar_comando  # noqa: E402
from app.storage.workdir import JobWorkdir  # noqa: E402

# Nombre del artefacto de video unido resultante del Paso 1.
NOMBRE_UNIDO: str = "unido.mp4"
NOMBRE_CONCAT_TXT: str = "concat.txt"

# Firma de un inspector de clips inyectable (por defecto usa ffprobe real).
Inspector = _Callable[[str], ClipInfo]


class NormalizacionError(Exception):
    """Fallo del Paso 1 (UNIR) que identifica el clip responsable (Req 3.6).

    Se lanza cuando un clip es corrupto/no decodificable o cuando ffmpeg falla al
    normalizar o concatenar. El motor detiene la unión y **no** produce salida
    parcial.
    """

    def __init__(self, ruta: _Optional[str], motivo: str) -> None:
        self.ruta = ruta
        self.motivo = motivo
        prefijo = f"clip {ruta!r}: " if ruta is not None else ""
        super().__init__(f"Fallo al unir: {prefijo}{motivo}")


def comando_normalizar_clip(
    entrada: str,
    salida: str,
    filtro: str,
    fps: int,
    tiene_audio: bool,
) -> List[str]:
    """Construye el comando ffmpeg que normaliza un clip a un intermedio (Req 3.1, 3.3).

    Aplica el filtro de escala + pad + fps (``filtro``) y homogeneiza el códec de
    video (H.264), la tasa de cuadros y el audio (AAC estéreo a 48 kHz). Cuando el
    clip **carece de pista de audio** se le inyecta audio silencioso con
    ``anullsrc`` para que la concatenación posterior sea homogénea (nota de diseño
    del Paso 1).

    Args:
        entrada: Ruta del clip de origen.
        salida: Ruta del intermedio normalizado a producir.
        filtro: Cadena de filtro de video (de :func:`cadena_filtro_normalizacion`).
        fps: Cuadros por segundo objetivo.
        tiene_audio: Si el clip de origen tiene pista de audio.

    Returns:
        La lista de argumentos del comando ffmpeg.
    """
    args: List[str] = [config.FFMPEG_BIN, "-y"]
    if tiene_audio:
        args += ["-i", entrada]
        map_args = ["-map", "0:v:0", "-map", "0:a:0"]
    else:
        # Audio silencioso como segunda entrada (Req 3.3: pista de audio homogénea).
        args += [
            "-f",
            "lavfi",
            "-i",
            "anullsrc=channel_layout=stereo:sample_rate=48000",
            "-i",
            entrada,
        ]
        map_args = ["-map", "1:v:0", "-map", "0:a:0", "-shortest"]

    args += ["-vf", filtro, "-r", str(int(fps))]
    args += map_args
    args += [
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-ar",
        "48000",
        "-ac",
        "2",
        salida,
    ]
    return args


def comando_concatenar(concat_txt: str, salida: str) -> List[str]:
    """Construye el comando ffmpeg del demuxer ``concat`` (Req 3.4).

    Como todos los intermedios comparten códec/parámetros, la concatenación con
    ``-c copy`` es válida y preserva el orden del ``concat.txt``.

    Args:
        concat_txt: Ruta del archivo ``concat.txt`` (una línea ``file`` por clip).
        salida: Ruta del video unido a producir.

    Returns:
        La lista de argumentos del comando ffmpeg.
    """
    return [
        config.FFMPEG_BIN,
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        concat_txt,
        "-c",
        "copy",
        salida,
    ]


def unir_clips(
    job: JobWorkdir,
    rutas_clips: Sequence[str],
    ancho_objetivo: int,
    alto_objetivo: int,
    fps: int,
    runner: Runner = ejecutar_comando,
    inspector: Inspector = inspeccionar_clip,
) -> _Path:
    """Ejecuta el Paso 1 (UNIR): normaliza cada clip y concatena en orden (Req 3).

    Flujo:

    1. Inspecciona cada clip con ``ffprobe`` (inyectable). Si alguno es corrupto o
       no decodificable, **detiene** el paso y lanza :class:`NormalizacionError`
       sin producir el video unido (Req 3.6).
    2. Normaliza cada clip a un intermedio ``norm_{i}.mp4`` con parámetros
       idénticos (resolución, fps, códec y audio; inyecta audio silencioso si
       falta pista) (Req 3.1, 3.3).
    3. Escribe ``concat.txt`` con los intermedios en el **orden del usuario** y
       concatena con el demuxer ``concat`` (reutiliza :func:`contenido_concat_txt`)
       (Req 3.4).

    Todos los artefactos se escriben dentro del workdir del Job (contención por
    prefijo, Req 13.3). Ante cualquier fallo se lanza :class:`NormalizacionError`
    y no se produce el artefacto ``unido.mp4`` (sin salida parcial, Req 3.6).

    Args:
        job: Directorio de trabajo del Job.
        rutas_clips: Rutas de los clips en el ``Orden_de_Clips`` del usuario.
        ancho_objetivo / alto_objetivo: Resolución objetivo compartida.
        fps: Cuadros por segundo objetivo compartido.
        runner: Ejecutor de comandos ffmpeg inyectable.
        inspector: Inspector de clips inyectable (por defecto, ffprobe real).

    Returns:
        La ruta del video unido (``unido.mp4``) dentro del workdir.

    Raises:
        NormalizacionError: Si no hay clips, un clip es inválido o ffmpeg falla.
    """
    if not rutas_clips:
        raise NormalizacionError(None, "no se recibió ningún clip para unir")

    job.create()

    # (1) Inspección previa: un clip inválido detiene la unión sin salida parcial.
    infos: List[ClipInfo] = []
    for ruta in rutas_clips:
        try:
            infos.append(inspector(ruta))
        except ClipInspeccionError as exc:
            raise NormalizacionError(exc.ruta, exc.motivo) from exc

    filtro = cadena_filtro_normalizacion(ancho_objetivo, alto_objetivo, fps)

    # (2) Normalización de cada clip a un intermedio homogéneo.
    intermedios: List[_Path] = []
    for indice, (ruta, info) in enumerate(zip(rutas_clips, infos)):
        salida = job.resolve("norm_%03d.mp4" % indice)
        comando = comando_normalizar_clip(
            entrada=ruta,
            salida=str(salida),
            filtro=filtro,
            fps=fps,
            tiene_audio=info.tiene_audio,
        )
        try:
            resultado = runner(comando)
        except OSError as exc:
            raise NormalizacionError(ruta, f"no se pudo ejecutar ffmpeg: {exc}") from exc
        if resultado.returncode != 0:
            detalle = (resultado.stderr or "").strip() or "código de salida distinto de cero"
            raise NormalizacionError(ruta, f"normalización falló: {detalle}")
        intermedios.append(salida)

    # (3) Concatenación en el orden del usuario (Propiedad 5 / Req 3.4).
    concat_txt = job.resolve(NOMBRE_CONCAT_TXT)
    concat_txt.write_text(
        contenido_concat_txt([str(p) for p in intermedios]), encoding="utf-8"
    )

    unido = job.resolve(NOMBRE_UNIDO)
    comando_concat = comando_concatenar(str(concat_txt), str(unido))
    try:
        resultado = runner(comando_concat)
    except OSError as exc:
        raise NormalizacionError(None, f"no se pudo ejecutar ffmpeg (concat): {exc}") from exc
    if resultado.returncode != 0:
        detalle = (resultado.stderr or "").strip() or "código de salida distinto de cero"
        raise NormalizacionError(None, f"concatenación falló: {detalle}")

    return unido


__all__ += [
    "NOMBRE_UNIDO",
    "NOMBRE_CONCAT_TXT",
    "Inspector",
    "NormalizacionError",
    "comando_normalizar_clip",
    "comando_concatenar",
    "unir_clips",
]
