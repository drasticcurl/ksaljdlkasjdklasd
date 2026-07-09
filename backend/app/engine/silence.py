"""Paso 2 del pipeline — Corte de silencios con ``auto-editor`` (Req 4).

Este módulo elimina las pausas de silencio del video invocando ``auto-editor``,
con las siguientes garantías:

* **No-op cuando está desactivado (Req 4.3, Propiedad 9):** si el corte de
  silencios está desactivado, el video de salida del paso es idéntico al de
  entrada (se devuelve la misma ruta, sin ejecutar nada).
* **Validación con último valor válido (Req 4.4, Propiedad 10):** el umbral (UI:
  -60..0 dB) y el margen (UI: 0..5000 ms) se validan contra sus rangos; un valor
  fuera de rango se **rechaza** (error) y el motor **conserva el último valor
  válido** previo. Esto se implementa con :class:`ValidadorSilencio`.
* **Conversión de unidades (Req 4.2):** el umbral en dB se convierte a porcentaje
  del motor y el margen en ms a segundos mediante :mod:`app.util.units`.
* **Fallo de la herramienta (Req 4.5):** si ``auto-editor`` falla (código != 0),
  se lanza :class:`SilenceProcessingError`; el video original no se recorta ni se
  sobrescribe (se escribe en un archivo de salida distinto).

Toda la ejecución externa pasa por un :data:`~app.engine.proc.Runner`
inyectable, por lo que los tests no dependen del binario ``auto-editor`` real.

Referencias de requisitos: 4.1, 4.2, 4.3, 4.4, 4.5.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import sys
from pathlib import Path
from typing import List, Optional, Tuple, Union

import errno

from app import config
from app.deps.path_setup import preparar_auto_editor
from app.engine.proc import Runner, ejecutar_comando
from app.util.units import (
    UI_MARGEN_MS_MAX,
    UI_MARGEN_MS_MIN,
    UI_UMBRAL_DB_MAX,
    UI_UMBRAL_DB_MIN,
    margen_ms_a_s,
    umbral_db_a_pct,
)

logger = logging.getLogger(__name__)

# Nombre del artefacto de video sin silencios producido por el Paso 2.
NOMBRE_CORTADO: str = "cortado.mp4"

# Pista accionable cuando auto-editor falla por falta de permiso de ejecución.
_PISTA_PERMISOS: str = (
    "el binario de auto-editor no es ejecutable; reinstala con "
    "`pip install --force-reinstall auto-editor` o verifica permisos"
)

# Guía accionable cuando macOS mata el binario de auto-editor (señal 9 / SIGKILL).
# Es el síntoma típico de un binario compilado sin firmar, en cuarentena o con
# firma inválida en macOS (Gatekeeper): el proceso muere sin stdout/stderr.
_GUIA_KILLED_MACOS: str = (
    "macOS terminó el binario de auto-editor con la señal 9 (SIGKILL); suele "
    "deberse a un binario sin firmar, en cuarentena o con firma inválida "
    "(Gatekeeper). Pasos para resolverlo:\n"
    "  1. Quitar la cuarentena del paquete: "
    "`xattr -dr com.apple.quarantine <venv>/lib/python*/site-packages/auto_editor`\n"
    "  2. Re-firmar ad-hoc: "
    "`codesign --force --deep --sign - <ruta del binario de auto-editor>`\n"
    "  3. Reinstalar auto-editor: `pip install --force-reinstall auto-editor`\n"
    "  4. O desactivar \"Cortar silencios\" en la interfaz para omitir este paso."
)

# Límite de caracteres de la salida de auto-editor que se incluye en el motivo
# del error, para no desbordar el mensaje del Job ni los logs.
_MAX_DETALLE_SALIDA: int = 1500


def _recortar_salida(texto: str, limite: int = _MAX_DETALLE_SALIDA) -> str:
    """Devuelve las últimas líneas útiles de ``texto`` recortadas a ``limite``.

    Se prioriza el final de la salida (donde las herramientas suelen imprimir el
    error real) y se recorta por la izquierda añadiendo una marca de truncado.
    """
    texto = (texto or "").strip()
    if len(texto) <= limite:
        return texto
    return "...(recortado)... " + texto[-limite:]


# Nombres legibles de las señales POSIX más relevantes al diagnosticar la
# terminación abrupta de un proceso hijo.
_NOMBRES_SENALES: dict[int, str] = {
    2: "SIGINT",
    6: "SIGABRT",
    9: "SIGKILL",
    11: "SIGSEGV",
    15: "SIGTERM",
}


def interpretar_codigo_salida(rc: int) -> Optional[str]:
    """Interpreta un ``returncode`` que probablemente indica muerte por señal.

    Un proceso terminado por una señal no produce necesariamente stdout/stderr,
    por lo que el único indicio del fallo es su código de salida. Esta función
    reconoce las dos convenciones habituales para codificar la señal en el código
    de salida:

    * ``rc < 0``: la señal es ``-rc`` (convención de :mod:`subprocess` en POSIX).
    * ``rc > 128``: se consideran dos codificaciones y se detecta la señal:
        - ``256 - rc`` (p. ej. ``247`` -> ``9``), y
        - ``rc - 128`` (p. ej. ``137`` -> ``9``).
      Si cualquiera de las dos apunta a la señal 9, se interpreta como SIGKILL.

    Args:
        rc: El ``returncode`` devuelto por el proceso.

    Returns:
        Una descripción legible cuando el código sugiere terminación por señal, o
        ``None`` para códigos de error "normales" (1..128 que no sean 137).
    """
    # Convención de subprocess en POSIX: código negativo => señal -rc.
    if rc < 0:
        senal = -rc
        return _describir_senal(senal)

    # Códigos > 128 suelen codificar la señal que terminó el proceso.
    if rc > 128:
        candidatos = {256 - rc, rc - 128}
        # Prioriza SIGKILL (9) si alguna convención lo indica.
        if 9 in candidatos:
            return _describir_senal(9)
        # Si no es 9, usa la convención estándar shell (128 + señal).
        senal = rc - 128
        if 0 < senal < 128:
            return _describir_senal(senal)
        return None

    # Códigos "normales" (incluido 0 y 1..128): sin interpretación de señal.
    return None


def _describir_senal(senal: int) -> str:
    """Devuelve una descripción legible de la terminación por ``senal``."""
    nombre = _NOMBRES_SENALES.get(senal)
    if nombre:
        return f"el proceso terminó por señal {senal} ({nombre})"
    return f"el proceso terminó por señal {senal}"


class SilenceValidationError(ValueError):
    """Un umbral o margen fuera de rango fue rechazado (Req 4.4)."""

    def __init__(self, campo: str, valor: object, minimo: float, maximo: float) -> None:
        self.campo = campo
        self.valor = valor
        self.minimo = minimo
        self.maximo = maximo
        super().__init__(
            f"{campo}={valor!r} fuera del rango permitido [{minimo}, {maximo}]"
        )


class SilenceProcessingError(Exception):
    """``auto-editor`` falló durante el corte de silencios (Req 4.5)."""


class ValidadorSilencio:
    """Mantiene el umbral y el margen válidos, conservando el último válido (Req 4.4).

    Se inicializa con valores por defecto (válidos). Cada intento de actualización
    valida el nuevo valor contra su rango de UI; si es válido, se adopta; si no,
    se lanza :class:`SilenceValidationError` y **se conserva el último valor
    válido** (Propiedad 10).
    """

    def __init__(
        self,
        umbral_db: float = config.DEFAULT_SILENCIO_UMBRAL_DB,
        margen_ms: int = config.DEFAULT_SILENCIO_MARGEN_MS,
    ) -> None:
        # Los valores iniciales deben ser válidos; se validan al construir.
        self._umbral_db = self._validar_umbral(umbral_db)
        self._margen_ms = self._validar_margen(margen_ms)

    @staticmethod
    def _validar_umbral(valor: float) -> float:
        if isinstance(valor, bool) or not isinstance(valor, (int, float)):
            raise SilenceValidationError(
                "umbral_db", valor, UI_UMBRAL_DB_MIN, UI_UMBRAL_DB_MAX
            )
        if not (UI_UMBRAL_DB_MIN <= valor <= UI_UMBRAL_DB_MAX):
            raise SilenceValidationError(
                "umbral_db", valor, UI_UMBRAL_DB_MIN, UI_UMBRAL_DB_MAX
            )
        return float(valor)

    @staticmethod
    def _validar_margen(valor: int) -> int:
        if isinstance(valor, bool) or not isinstance(valor, (int, float)):
            raise SilenceValidationError(
                "margen_ms", valor, UI_MARGEN_MS_MIN, UI_MARGEN_MS_MAX
            )
        if not (UI_MARGEN_MS_MIN <= valor <= UI_MARGEN_MS_MAX):
            raise SilenceValidationError(
                "margen_ms", valor, UI_MARGEN_MS_MIN, UI_MARGEN_MS_MAX
            )
        return int(valor)

    @property
    def umbral_db(self) -> float:
        """Último umbral (dB) válido conservado."""
        return self._umbral_db

    @property
    def margen_ms(self) -> int:
        """Último margen (ms) válido conservado."""
        return self._margen_ms

    def actualizar_umbral(self, valor: float) -> float:
        """Adopta ``valor`` como umbral si es válido; si no, conserva el anterior.

        Raises:
            SilenceValidationError: Si ``valor`` está fuera de rango. En tal caso
                el umbral conservado no cambia (Req 4.4, Propiedad 10).
        """
        validado = self._validar_umbral(valor)
        self._umbral_db = validado
        return validado

    def actualizar_margen(self, valor: int) -> int:
        """Adopta ``valor`` como margen si es válido; si no, conserva el anterior.

        Raises:
            SilenceValidationError: Si ``valor`` está fuera de rango. En tal caso
                el margen conservado no cambia (Req 4.4, Propiedad 10).
        """
        validado = self._validar_margen(valor)
        self._margen_ms = validado
        return validado


def comando_auto_editor(entrada: str, salida: str, umbral_pct: float, margen_s: float) -> List[str]:
    """Construye el comando ``auto-editor`` para cortar silencios (Req 4.1, 4.2).

    El umbral se pasa como porcentaje del motor y el margen en segundos (ya
    convertidos desde las unidades de la UI). ``--no-open`` evita abrir un
    reproductor al terminar.

    Args:
        entrada: Ruta del video de entrada.
        salida: Ruta del video de salida (recortado).
        umbral_pct: Umbral de audio en porcentaje (0..100).
        margen_s: Margen en segundos (0..5).

    Returns:
        La lista de argumentos del comando ``auto-editor``.
    """
    return [
        "auto-editor",
        entrada,
        "--edit",
        "audio:threshold=%s%%" % _fmt(umbral_pct),
        "--margin",
        "%ss" % _fmt(margen_s),
        "--no-open",
        "-o",
        salida,
    ]


def _fmt(valor: float) -> str:
    """Formatea un número sin ceros/comas innecesarios para la línea de comando."""
    entero = round(float(valor), 4)
    if entero == int(entero):
        return str(int(entero))
    return ("%.4f" % entero).rstrip("0").rstrip(".")


# ===========================================================================
# Motor nativo de ffmpeg (silencedetect + recorte con select/aselect)
# ===========================================================================
#
# Alternativa a ``auto-editor`` que no depende de un binario externo firmado:
# usa ffmpeg (ya presente para el resto del pipeline). El flujo es:
#
#   1. Detectar los tramos de silencio con el filtro ``silencedetect`` (que
#      imprime ``silence_start``/``silence_end`` por stderr).
#   2. Obtener la duración del video con ``ffprobe``.
#   3. Calcular (lógica pura) los segmentos a CONSERVAR (complemento de los
#      silencios), expandidos por el margen y fusionados.
#   4. Recortar con ``select``/``aselect`` reconstruyendo la línea de tiempo.
#
# Las funciones de parseo y cálculo son PURAS para poder probarlas sin ffmpeg.

# Regex de las marcas que imprime el filtro ``silencedetect`` en stderr.
_RE_SILENCE_START = re.compile(r"silence_start:\s*(-?\d+(?:\.\d+)?)")
_RE_SILENCE_END = re.compile(r"silence_end:\s*(-?\d+(?:\.\d+)?)")


def parsear_silencedetect(stderr: str) -> List[Tuple[float, float]]:
    """Extrae los tramos de silencio ``(inicio, fin)`` del stderr de ffmpeg (PURA).

    El filtro ``silencedetect`` imprime líneas con ``silence_start: <t>`` y, más
    tarde, ``silence_end: <t>``. Esta función empareja cada ``start`` con su
    ``end`` siguiente. Si un ``start`` no tiene ``end`` (el silencio llega hasta
    el final del audio), se registra con fin ``inf`` para que el llamador lo
    recorte contra la duración real.

    Args:
        stderr: Salida de error de ffmpeg con el filtro ``silencedetect``.

    Returns:
        Lista ordenada de tuplas ``(inicio, fin)``; vacía si no hay silencios.
    """
    silencios: List[Tuple[float, float]] = []
    inicio_pendiente: Optional[float] = None

    for linea in (stderr or "").splitlines():
        m_ini = _RE_SILENCE_START.search(linea)
        if m_ini is not None:
            inicio_pendiente = float(m_ini.group(1))
            continue
        m_fin = _RE_SILENCE_END.search(linea)
        if m_fin is not None:
            fin = float(m_fin.group(1))
            if inicio_pendiente is not None:
                silencios.append((inicio_pendiente, fin))
                inicio_pendiente = None
            else:
                # end sin start previo: silencio desde el inicio del audio.
                silencios.append((0.0, fin))

    # start sin end: silencio hasta el final (se marca con inf).
    if inicio_pendiente is not None:
        silencios.append((inicio_pendiente, float("inf")))

    return silencios


def calcular_segmentos_conservar(
    silencios: List[Tuple[float, float]], duracion: float, margen_s: float
) -> List[Tuple[float, float]]:
    """Calcula los segmentos a CONSERVAR (complemento de los silencios) (PURA).

    A partir de los tramos de silencio y la duración total, obtiene el
    complemento dentro de ``[0, duracion]`` (las partes con voz), expande cada
    segmento conservado ``margen_s`` a cada lado (clamp a ``[0, duracion]``),
    fusiona los solapados y descarta los de longitud <= 0.

    Garantías (nunca salida vacía; nunca inicio > fin):

    * Sin silencios -> ``[(0, duracion)]``.
    * Todo silencio -> ``[(0, duracion)]`` (nunca se devuelve vacío).
    * Resultado ordenado y sin solapes.

    Args:
        silencios: Tramos de silencio ``(inicio, fin)`` (fin puede ser ``inf``).
        duracion: Duración total del medio en segundos (> 0).
        margen_s: Margen en segundos a añadir a cada lado de lo conservado.

    Returns:
        Lista ordenada de segmentos ``(inicio, fin)`` a conservar.
    """
    if duracion <= 0:
        return [(0.0, 0.0)]

    # Normaliza y recorta los silencios a [0, duracion], ordenados por inicio.
    normalizados: List[Tuple[float, float]] = []
    for ini, fin in silencios:
        ini_c = max(0.0, min(float(ini), duracion))
        fin_c = duracion if fin == float("inf") else max(0.0, min(float(fin), duracion))
        if fin_c > ini_c:
            normalizados.append((ini_c, fin_c))
    normalizados.sort()

    # Fusiona silencios solapados para calcular el complemento correctamente.
    silencios_fusionados: List[Tuple[float, float]] = []
    for ini, fin in normalizados:
        if silencios_fusionados and ini <= silencios_fusionados[-1][1]:
            prev_ini, prev_fin = silencios_fusionados[-1]
            silencios_fusionados[-1] = (prev_ini, max(prev_fin, fin))
        else:
            silencios_fusionados.append((ini, fin))

    # Complemento: los tramos de [0, duracion] que NO son silencio.
    conservar: List[Tuple[float, float]] = []
    cursor = 0.0
    for ini, fin in silencios_fusionados:
        if ini > cursor:
            conservar.append((cursor, ini))
        cursor = max(cursor, fin)
    if cursor < duracion:
        conservar.append((cursor, duracion))

    # Expande cada segmento conservado por el margen (clamp a [0, duracion]).
    expandidos: List[Tuple[float, float]] = []
    for ini, fin in conservar:
        ini_e = max(0.0, ini - margen_s)
        fin_e = min(duracion, fin + margen_s)
        if fin_e > ini_e:
            expandidos.append((ini_e, fin_e))

    # Fusiona los segmentos conservados que se solapen tras la expansión.
    fusionados: List[Tuple[float, float]] = []
    for ini, fin in sorted(expandidos):
        if fusionados and ini <= fusionados[-1][1]:
            prev_ini, prev_fin = fusionados[-1]
            fusionados[-1] = (prev_ini, max(prev_fin, fin))
        else:
            fusionados.append((ini, fin))

    # Nunca devolver vacío (todo silencio -> conservar todo el video).
    if not fusionados:
        return [(0.0, duracion)]

    return fusionados


def construir_filtro_recorte(segmentos: List[Tuple[float, float]]) -> str:
    """Construye el ``filter_complex`` de recorte con ``select``/``aselect`` (PURA).

    Reconstruye la línea de tiempo conservando solo ``segmentos`` mediante
    expresiones ``between(t, inicio, fin)`` unidas con ``+`` (OR lógico), y
    reajusta los PTS de video y audio.

    Args:
        segmentos: Segmentos a conservar ``(inicio, fin)``.

    Returns:
        La cadena del ``filter_complex``.
    """
    sel = "+".join(
        "between(t,%s,%s)" % (_fmt(s), _fmt(e)) for s, e in segmentos
    )
    return (
        "[0:v]select='%s',setpts=N/FRAME_RATE/TB[v];"
        "[0:a]aselect='%s',asetpts=N/SR/STB[a]" % (sel, sel)
    )


def comando_silencedetect(
    entrada: str, umbral_db: float, min_silencio_s: float
) -> List[str]:
    """Construye el comando ffmpeg de detección de silencios (``silencedetect``).

    No produce salida de video/audio (``-f null -`` descarta la salida); las
    marcas ``silence_start``/``silence_end`` se emiten por stderr.

    Args:
        entrada: Ruta del video de entrada.
        umbral_db: Umbral de ruido en dB (negativo; se usa directo en ``noise=``).
        min_silencio_s: Duración mínima de silencio en segundos (``d=``).

    Returns:
        La lista de argumentos del comando ffmpeg.
    """
    return [
        "ffmpeg",
        "-hide_banner",
        "-nostats",
        "-i",
        entrada,
        "-af",
        "silencedetect=noise=%sdB:d=%s" % (_fmt(umbral_db), _fmt(min_silencio_s)),
        "-f",
        "null",
        "-",
    ]


def comando_recorte_ffmpeg(entrada: str, salida: str, filtro: str) -> List[str]:
    """Construye el comando ffmpeg de recorte con ``filter_complex``.

    Args:
        entrada: Ruta del video de entrada.
        salida: Ruta del video recortado a producir.
        filtro: ``filter_complex`` construido con :func:`construir_filtro_recorte`.

    Returns:
        La lista de argumentos del comando ffmpeg.
    """
    return [
        "ffmpeg",
        "-y",
        "-i",
        entrada,
        "-filter_complex",
        filtro,
        "-map",
        "[v]",
        "-map",
        "[a]",
        salida,
    ]


def obtener_duracion(entrada: str, runner: Runner = ejecutar_comando) -> float:
    """Obtiene la duración del medio (segundos) con ``ffprobe``.

    Args:
        entrada: Ruta del medio a inspeccionar.
        runner: Ejecutor de comandos inyectable.

    Returns:
        La duración en segundos.

    Raises:
        SilenceProcessingError: Si ``ffprobe`` falla o su salida no es un número.
    """
    comando = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        entrada,
    ]
    try:
        resultado = runner(comando)
    except OSError as exc:
        raise SilenceProcessingError(
            f"no se pudo ejecutar ffprobe para obtener la duración: {exc}"
        ) from exc

    if resultado.returncode != 0:
        detalle = _recortar_salida((resultado.stderr or "").strip()) or (
            "código de salida distinto de cero"
        )
        raise SilenceProcessingError(
            f"ffprobe falló al obtener la duración (código {resultado.returncode}): "
            f"{detalle}"
        )

    texto = (resultado.stdout or "").strip()
    try:
        return float(texto)
    except (ValueError, TypeError) as exc:
        raise SilenceProcessingError(
            f"no se pudo interpretar la duración devuelta por ffprobe: {texto!r}"
        ) from exc


def cortar_silencios_ffmpeg(
    entrada: Union[str, Path],
    salida: Union[str, Path],
    umbral_db: float,
    margen_ms: float,
    runner: Runner = ejecutar_comando,
) -> Path:
    """Corta los silencios usando el motor nativo de ffmpeg (Req 4.1, 4.5).

    Orquesta: detección (``silencedetect``) -> duración (``ffprobe``) -> cálculo
    de segmentos a conservar (puro) -> recorte (``select``/``aselect``). Si algún
    comando ffmpeg/ffprobe devuelve código != 0 se lanza
    :class:`SilenceProcessingError` con el código y el stderr recortado.

    Para este motor el umbral se usa en **dB directo** y el margen se convierte a
    segundos (``margen_ms / 1000``).

    Args:
        entrada: Ruta del video de entrada.
        salida: Ruta del video recortado a producir.
        umbral_db: Umbral de ruido en dB (UI, negativo).
        margen_ms: Margen en milisegundos.
        runner: Ejecutor de comandos inyectable.

    Returns:
        La ruta del video recortado.

    Raises:
        SilenceProcessingError: Si ffmpeg/ffprobe fallan.
    """
    entrada_path = Path(entrada)
    salida_path = Path(salida)
    margen_s = float(margen_ms) / 1000.0

    logger.info("ffmpeg resuelto en: %s", shutil.which("ffmpeg") or "(no encontrado)")
    logger.info("ffprobe resuelto en: %s", shutil.which("ffprobe") or "(no encontrado)")
    _loguear_archivo_entrada(entrada_path)

    # (1) Detección de silencios.
    cmd_detect = comando_silencedetect(
        str(entrada_path), umbral_db, config.DEFAULT_MIN_SILENCIO_S
    )
    logger.info("Ejecutando silencedetect: %s", " ".join(cmd_detect))
    try:
        res_detect = runner(cmd_detect)
    except OSError as exc:
        raise SilenceProcessingError(
            f"no se pudo ejecutar ffmpeg (silencedetect): {exc}"
        ) from exc
    if res_detect.returncode != 0:
        detalle = _recortar_salida((res_detect.stderr or "").strip())
        interpretacion = interpretar_codigo_salida(res_detect.returncode)
        sufijo = f" ({interpretacion})" if interpretacion else ""
        logger.error(
            "ffmpeg (silencedetect) falló (código %s). Comando: %s\nstderr:\n%s",
            res_detect.returncode,
            " ".join(cmd_detect),
            (res_detect.stderr or "").strip() or "(vacío)",
        )
        raise SilenceProcessingError(
            f"ffmpeg (silencedetect) falló (código {res_detect.returncode}): "
            f"{detalle or 'sin salida de diagnóstico'}{sufijo}"
        )

    silencios = parsear_silencedetect(res_detect.stderr or "")

    # (2) Duración total del medio.
    duracion = obtener_duracion(str(entrada_path), runner)

    # (3) Cálculo (puro) de los segmentos a conservar.
    segmentos = calcular_segmentos_conservar(silencios, duracion, margen_s)
    filtro = construir_filtro_recorte(segmentos)
    logger.info(
        "Silencios detectados: %d; segmentos a conservar: %d",
        len(silencios),
        len(segmentos),
    )

    # (4) Recorte.
    cmd_recorte = comando_recorte_ffmpeg(str(entrada_path), str(salida_path), filtro)
    logger.info("Ejecutando recorte ffmpeg: %s", " ".join(cmd_recorte))
    try:
        res_recorte = runner(cmd_recorte)
    except OSError as exc:
        raise SilenceProcessingError(
            f"no se pudo ejecutar ffmpeg (recorte): {exc}"
        ) from exc
    if res_recorte.returncode != 0:
        detalle = _recortar_salida((res_recorte.stderr or "").strip())
        interpretacion = interpretar_codigo_salida(res_recorte.returncode)
        sufijo = f" ({interpretacion})" if interpretacion else ""
        logger.error(
            "ffmpeg (recorte) falló (código %s). Comando: %s\nstderr:\n%s",
            res_recorte.returncode,
            " ".join(cmd_recorte),
            (res_recorte.stderr or "").strip() or "(vacío)",
        )
        raise SilenceProcessingError(
            f"ffmpeg (recorte) falló (código {res_recorte.returncode}): "
            f"{detalle or 'sin salida de diagnóstico'}{sufijo}"
        )

    return salida_path


def cortar_silencios(
    entrada: Union[str, Path],
    salida: Union[str, Path],
    *,
    activado: bool,
    umbral_db: Optional[float] = None,
    margen_ms: Optional[int] = None,
    validador: Optional[ValidadorSilencio] = None,
    runner: Runner = ejecutar_comando,
    engine: Optional[str] = None,
) -> Path:
    """Ejecuta el Paso 2 (corte de silencios) o lo omite si está desactivado.

    * Si ``activado`` es ``False``: **no-op**; devuelve la ruta de entrada sin
      modificar (el video de salida es idéntico al de entrada) (Req 4.3,
      Propiedad 9).
    * Si ``activado`` es ``True``: valida umbral/margen (conservando el último
      válido ante valores fuera de rango, Req 4.4), los convierte a unidades del
      motor (Req 4.2) e invoca ``auto-editor`` (Req 4.1). Si la herramienta falla,
      lanza :class:`SilenceProcessingError` sin recortar el original (Req 4.5).

    Args:
        entrada: Ruta del video de entrada al paso.
        salida: Ruta del video de salida (recortado) cuando el paso se ejecuta.
        activado: Si el corte de silencios está activado.
        umbral_db: Umbral en dB (UI). Por defecto, el del ``validador``.
        margen_ms: Margen en ms (UI). Por defecto, el del ``validador``.
        validador: :class:`ValidadorSilencio` con el último valor válido; si es
            ``None`` se crea uno con los valores por defecto.
        runner: Ejecutor de comandos inyectable.
        engine: Motor de corte a usar (``"ffmpeg"`` o ``"auto-editor"``). Si es
            ``None`` se usa ``config.SILENCE_ENGINE`` (por defecto ``"ffmpeg"``).

    Returns:
        La ruta del video resultante: la de **entrada** si está desactivado, o la
        de **salida** si se ejecutó el corte.

    Raises:
        SilenceValidationError: Si el umbral o el margen están fuera de rango.
        SilenceProcessingError: Si ``auto-editor`` falla.
    """
    entrada_path = Path(entrada)

    # Req 4.3 / Propiedad 9: desactivado => no-op, salida idéntica a la entrada.
    if not activado:
        return entrada_path

    if validador is None:
        validador = ValidadorSilencio()

    # Req 4.4: validar (y conservar el último válido ante fuera de rango).
    # La validación se hace ANTES de elegir el motor, para rechazar valores
    # fuera de rango independientemente del backend.
    umbral_efectivo = (
        validador.actualizar_umbral(umbral_db)
        if umbral_db is not None
        else validador.umbral_db
    )
    margen_efectivo = (
        validador.actualizar_margen(margen_ms)
        if margen_ms is not None
        else validador.margen_ms
    )

    # Selección del motor (Req 4.1): por defecto ffmpeg nativo; "auto-editor" usa
    # la ruta histórica. Cualquier otro valor recae en ffmpeg.
    motor = engine if engine is not None else config.SILENCE_ENGINE
    if motor != "auto-editor":
        # Motor ffmpeg: umbral en dB directo, margen en ms (se convierte a s
        # dentro de la función).
        return cortar_silencios_ffmpeg(
            entrada_path,
            salida,
            umbral_efectivo,
            margen_efectivo,
            runner=runner,
        )

    # -------------------- Motor auto-editor (histórico) --------------------
    # Req 4.2: conversión de unidades UI -> motor.
    umbral_pct = umbral_db_a_pct(umbral_efectivo)
    margen_s = margen_ms_a_s(margen_efectivo)

    # Defensa ante binarios de auto-editor empaquetados sin bit de ejecución
    # ([Errno 13] Permission denied) y, en macOS, ante binarios en cuarentena o
    # sin firma que el sistema mata con SIGKILL. Idempotente y tolerante a fallos.
    preparar_auto_editor()

    salida_path = Path(salida)
    comando = comando_auto_editor(str(entrada_path), str(salida_path), umbral_pct, margen_s)

    # Diagnóstico previo: rutas resueltas de las herramientas y del archivo de
    # entrada. Ayuda a distinguir "binario ausente" de "binario que muere".
    logger.info("auto-editor resuelto en: %s", shutil.which("auto-editor") or "(no encontrado)")
    logger.info("ffmpeg resuelto en: %s", shutil.which("ffmpeg") or "(no encontrado)")
    _loguear_archivo_entrada(entrada_path)

    # Loguea el comando EXACTO (argv completo) antes de ejecutarlo, para poder
    # reproducir manualmente la invocación al diagnosticar fallos.
    logger.info("Ejecutando auto-editor: %s", " ".join(comando))
    try:
        resultado = runner(comando)
    except PermissionError as exc:
        raise SilenceProcessingError(
            f"no se pudo ejecutar auto-editor: {exc}. {_PISTA_PERMISOS}"
        ) from exc
    except OSError as exc:
        # Errno 13 (permiso denegado) puede llegar como OSError según el SO.
        if getattr(exc, "errno", None) == errno.EACCES:
            raise SilenceProcessingError(
                f"no se pudo ejecutar auto-editor: {exc}. {_PISTA_PERMISOS}"
            ) from exc
        raise SilenceProcessingError(
            f"no se pudo ejecutar auto-editor: {exc}"
        ) from exc

    if resultado.returncode != 0:
        stderr_texto = (resultado.stderr or "").strip()
        stdout_texto = (resultado.stdout or "").strip()

        # Interpretación del código de salida: si el proceso murió por señal
        # (p. ej. 247 -> SIGKILL en macOS), añade esa lectura al diagnóstico.
        interpretacion = interpretar_codigo_salida(resultado.returncode)
        es_sigkill = interpretacion is not None and "señal 9" in interpretacion

        # Loguea la salida COMPLETA a nivel error para diagnóstico sin recortes,
        # incluida la interpretación del código de salida cuando aplica.
        logger.error(
            "auto-editor falló (código %s)%s. Comando: %s\nstderr:\n%s\nstdout:\n%s",
            resultado.returncode,
            f" — {interpretacion}" if interpretacion else "",
            " ".join(comando),
            stderr_texto or "(vacío)",
            stdout_texto or "(vacío)",
        )

        # Para el motivo del Job usamos stderr (donde va el error real); si está
        # vacío, recurrimos a stdout. Recortamos a ~1500 caracteres.
        fuente = stderr_texto or stdout_texto
        detalle = _recortar_salida(fuente) if fuente else ""

        # Sufijo con la interpretación del código de salida (SIEMPRE que aplique)
        # y, si fue SIGKILL en macOS, la guía accionable específica.
        sufijo_senal = f" ({interpretacion})" if interpretacion else ""
        if es_sigkill and sys.platform == "darwin":
            sufijo_senal += f". {_GUIA_KILLED_MACOS}"

        # auto-editor puede reportar el fallo de permisos en su salida (sin lanzar
        # excepción): p. ej. "[Errno 13] Permission denied". Añade la pista.
        fuente_lower = fuente.lower()
        if "errno 13" in fuente_lower or "permission denied" in fuente_lower:
            raise SilenceProcessingError(
                f"auto-editor falló (código {resultado.returncode}): {detalle}. "
                f"{_PISTA_PERMISOS}{sufijo_senal}"
            )

        if detalle:
            raise SilenceProcessingError(
                f"auto-editor falló (código {resultado.returncode}): "
                f"{detalle}{sufijo_senal}"
            )
        raise SilenceProcessingError(
            f"auto-editor falló (código {resultado.returncode}): "
            f"sin salida de diagnóstico (stderr y stdout vacíos){sufijo_senal}"
        )

    return salida_path


def _loguear_archivo_entrada(entrada_path: Path) -> None:
    """Loguea a INFO la existencia y el tamaño del archivo de entrada.

    Es tolerante a fallos: cualquier error del sistema de archivos se reduce a un
    aviso, sin interrumpir el flujo del corte de silencios.
    """
    ruta = str(entrada_path)
    try:
        existe = os.path.exists(ruta)
        if existe:
            tamano = os.path.getsize(ruta)
            logger.info("Archivo de entrada %s existe (%d bytes)", ruta, tamano)
        else:
            logger.info("Archivo de entrada %s NO existe", ruta)
    except OSError as exc:  # pragma: no cover - defensivo
        logger.warning("No se pudo inspeccionar el archivo de entrada %s: %s", ruta, exc)


__all__ = [
    "NOMBRE_CORTADO",
    "SilenceValidationError",
    "SilenceProcessingError",
    "ValidadorSilencio",
    "comando_auto_editor",
    "cortar_silencios",
    "cortar_silencios_ffmpeg",
    "parsear_silencedetect",
    "calcular_segmentos_conservar",
    "construir_filtro_recorte",
    "comando_silencedetect",
    "comando_recorte_ffmpeg",
    "obtener_duracion",
    "interpretar_codigo_salida",
]
