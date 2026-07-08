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
import shutil
import sys
from pathlib import Path
from typing import List, Optional, Union

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


def cortar_silencios(
    entrada: Union[str, Path],
    salida: Union[str, Path],
    *,
    activado: bool,
    umbral_db: Optional[float] = None,
    margen_ms: Optional[int] = None,
    validador: Optional[ValidadorSilencio] = None,
    runner: Runner = ejecutar_comando,
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
    "interpretar_codigo_salida",
]
