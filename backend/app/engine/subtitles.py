"""Paso 4 del pipeline — Subtítulos animados: generar ASS y quemarlo (Req 7).

Este módulo enlaza la lógica pura de agrupación (``engine/grouping.py``) y de
construcción del ASS (``engine/ass_builder.py``) con el **efecto** de quemar los
subtítulos en el video mediante ffmpeg (``-vf "ass=..."``).

Garantías:

* **Rechazo previo de configuración fuera de rango (Req 7.11):** antes de quemar
  se validan los campos de subtítulos (rangos del motor y formato de color); si
  alguno es inválido se lanza :class:`ConfiguracionSubtitulosError` identificando
  el/los campo(s), sin invocar ffmpeg.
* **Conservación del original y reporte de fallo (Req 7.10):** el video quemado
  se escribe en un archivo de salida distinto; si ffmpeg devuelve código != 0 o
  no produce el archivo de salida, se lanza :class:`SubtitulosError` y el video
  original se conserva.

La ejecución de ffmpeg pasa por un :data:`~app.engine.proc.Runner` inyectable y
la comprobación de existencia del archivo de salida es inyectable
(``existe_salida``), de modo que los tests no dependan del binario ffmpeg real.

Referencias de requisitos: 7.1, 7.2, 7.10, 7.11.
"""

from __future__ import annotations

from pathlib import Path
from typing import Callable, List, Optional, Sequence, Union

from app.engine.ass_builder import construir_ass
from app.engine.grouping import agrupar
from app.engine.proc import Runner, ejecutar_comando
from app.models.settings import (
    RANGOS_MOTOR,
    AjustesSubtitulos,
    GrupoSubtitulo,
    Palabra,
    ResolucionObjetivo,
    color_valido,
)

# Nombres de artefactos del Paso 4.
NOMBRE_ASS: str = "subtitulos.ass"
NOMBRE_SUBTITULADO: str = "subtitulado.mp4"

# Prefijo de las rutas de campo de subtítulos dentro de RANGOS_MOTOR.
_PREFIJO_SUBTITULOS: str = "subtitulos."


class ConfiguracionSubtitulosError(ValueError):
    """La configuración de subtítulos está fuera de rango o de formato (Req 7.11)."""

    def __init__(self, campos_invalidos: List[str]) -> None:
        self.campos_invalidos = list(campos_invalidos)
        super().__init__(
            "Configuración de subtítulos inválida; campos fuera de rango: "
            + ", ".join(self.campos_invalidos)
        )


class SubtitulosError(Exception):
    """ffmpeg falló al quemar los subtítulos (Req 7.10)."""


def validar_config_subtitulos(subtitulos: AjustesSubtitulos) -> List[str]:
    """Valida los campos de subtítulos contra los rangos del motor (Req 7.11).

    Comprueba los rangos numéricos de ``RANGOS_MOTOR`` cuyo prefijo es
    ``subtitulos.`` y el formato ``#RRGGBB`` de los colores. No incluye
    ``max_palabras`` (se corrige por fallback en la agrupación, Req 6.2).

    Returns:
        La lista de nombres de campo inválidos (vacía si la configuración es
        válida).
    """
    invalidos: List[str] = []
    for ruta, (minimo, maximo) in RANGOS_MOTOR.items():
        if not ruta.startswith(_PREFIJO_SUBTITULOS):
            continue
        atributo = ruta[len(_PREFIJO_SUBTITULOS) :]
        valor = getattr(subtitulos, atributo)
        if isinstance(valor, bool) or not isinstance(valor, (int, float)):
            invalidos.append(ruta)
        elif not (minimo <= valor <= maximo):
            invalidos.append(ruta)

    if not color_valido(subtitulos.color):
        invalidos.append("subtitulos.color")
    if not color_valido(subtitulos.color_borde):
        invalidos.append("subtitulos.color_borde")

    return invalidos


def comando_quemar_subtitulos(entrada: str, ass_path: str, salida: str) -> List[str]:
    """Construye el comando ffmpeg que quema el ASS en el video (Req 7.2).

    Usa ``-vf "ass=<ruta>"`` y copia el audio sin recodificar (``-c:a copy``).

    Args:
        entrada: Ruta del video de entrada.
        ass_path: Ruta del archivo ``.ass`` de subtítulos.
        salida: Ruta del video subtitulado a producir.

    Returns:
        La lista de argumentos del comando ffmpeg.
    """
    return [
        "ffmpeg",
        "-y",
        "-i",
        entrada,
        "-vf",
        "ass=%s" % ass_path,
        "-c:a",
        "copy",
        salida,
    ]


def generar_y_quemar_subtitulos(
    entrada: Union[str, Path],
    palabras: Sequence[Palabra],
    subtitulos: AjustesSubtitulos,
    resolucion: ResolucionObjetivo,
    ass_path: Union[str, Path],
    salida: Union[str, Path],
    *,
    runner: Runner = ejecutar_comando,
    existe_salida: Optional[Callable[[Path], bool]] = None,
) -> Path:
    """Ejecuta el Paso 4: agrupa, genera el ASS y lo quema con ffmpeg (Req 7).

    Flujo:

    1. **Rechaza** la configuración de subtítulos fuera de rango **antes** de
       quemar (Req 7.11).
    2. Agrupa las palabras (``grouping.agrupar``) y construye el texto ASS
       (``ass_builder.construir_ass``), escribiéndolo en ``ass_path`` (Req 7.1).
    3. Quema el ASS con ffmpeg (Req 7.2). Si ffmpeg falla (código != 0) o no
       produce el archivo de salida, lanza :class:`SubtitulosError` conservando el
       video original (Req 7.10).

    Args:
        entrada: Ruta del video de entrada.
        palabras: Palabras transcritas (con timestamps por palabra).
        subtitulos: Ajustes de subtítulos (estilo, posición, animación).
        resolucion: Resolución objetivo (fija ``PlayResX``/``PlayResY``).
        ass_path: Ruta donde escribir el ``.ass`` generado.
        salida: Ruta del video subtitulado a producir.
        runner: Ejecutor de comandos ffmpeg inyectable.
        existe_salida: Predicado inyectable que indica si el archivo de salida
            existe (por defecto, comprobación real en disco).

    Returns:
        La ruta del video subtitulado.

    Raises:
        ConfiguracionSubtitulosError: Configuración fuera de rango (Req 7.11).
        SubtitulosError: ffmpeg falló o no produjo salida (Req 7.10).
    """
    # (1) Req 7.11: rechazo temprano de configuración inválida.
    invalidos = validar_config_subtitulos(subtitulos)
    if invalidos:
        raise ConfiguracionSubtitulosError(invalidos)

    # (2) Agrupación + construcción del ASS (Req 7.1).
    grupos: List[GrupoSubtitulo] = agrupar(palabras, subtitulos.max_palabras)
    ass_texto = construir_ass(grupos, subtitulos, resolucion)
    ass_path_obj = Path(ass_path)
    ass_path_obj.parent.mkdir(parents=True, exist_ok=True)
    ass_path_obj.write_text(ass_texto, encoding="utf-8")

    # (3) Quemado con ffmpeg (Req 7.2, 7.10).
    salida_path = Path(salida)
    comando = comando_quemar_subtitulos(str(entrada), str(ass_path_obj), str(salida_path))
    try:
        resultado = runner(comando)
    except OSError as exc:
        raise SubtitulosError(f"no se pudo ejecutar ffmpeg: {exc}") from exc

    if resultado.returncode != 0:
        detalle = (resultado.stderr or "").strip() or "código de salida distinto de cero"
        raise SubtitulosError(f"ffmpeg falló al quemar subtítulos: {detalle}")

    comprobar = existe_salida if existe_salida is not None else (lambda p: p.exists())
    if not comprobar(salida_path):
        raise SubtitulosError(
            "ffmpeg no produjo el archivo de salida subtitulado"
        )

    return salida_path


__all__ = [
    "NOMBRE_ASS",
    "NOMBRE_SUBTITULADO",
    "ConfiguracionSubtitulosError",
    "SubtitulosError",
    "validar_config_subtitulos",
    "comando_quemar_subtitulos",
    "generar_y_quemar_subtitulos",
]
