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

from pathlib import Path
from typing import List, Optional, Union

from app import config
from app.engine.proc import Runner, ejecutar_comando
from app.util.units import (
    UI_MARGEN_MS_MAX,
    UI_MARGEN_MS_MIN,
    UI_UMBRAL_DB_MAX,
    UI_UMBRAL_DB_MIN,
    margen_ms_a_s,
    umbral_db_a_pct,
)

# Nombre del artefacto de video sin silencios producido por el Paso 2.
NOMBRE_CORTADO: str = "cortado.mp4"


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

    salida_path = Path(salida)
    comando = comando_auto_editor(str(entrada_path), str(salida_path), umbral_pct, margen_s)
    try:
        resultado = runner(comando)
    except OSError as exc:
        raise SilenceProcessingError(
            f"no se pudo ejecutar auto-editor: {exc}"
        ) from exc

    if resultado.returncode != 0:
        detalle = (resultado.stderr or "").strip() or "código de salida distinto de cero"
        raise SilenceProcessingError(f"auto-editor falló: {detalle}")

    return salida_path


__all__ = [
    "NOMBRE_CORTADO",
    "SilenceValidationError",
    "SilenceProcessingError",
    "ValidadorSilencio",
    "comando_auto_editor",
    "cortar_silencios",
]
