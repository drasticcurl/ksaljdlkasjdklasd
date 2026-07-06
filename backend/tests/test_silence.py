"""Tests del Paso 2 — Corte de silencios (Tareas 11.4 y 11.5, Req 4).

Contiene:

* **Propiedad 9** (Feature: vertical-shorts-editor, Property 9): el corte de
  silencios **desactivado** es un no-op; el video de salida es idéntico al de
  entrada y no se invoca ``auto-editor``.
  **Validates: Requisitos 4.3**
* **Propiedad 10** (Feature: vertical-shorts-editor, Property 10): la validación
  de umbral/margen **conserva el último valor válido**; un valor fuera de rango
  se rechaza (error) sin alterar el último valor válido previo.
  **Validates: Requisitos 4.4**

La ejecución de ``auto-editor`` se simula con un runner inyectable; los tests no
dependen del binario real.
"""

from __future__ import annotations

from pathlib import Path
from typing import List, Sequence, Tuple

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from app.engine.proc import ResultadoComando
from app.engine.silence import (
    SilenceProcessingError,
    SilenceValidationError,
    ValidadorSilencio,
    comando_auto_editor,
    cortar_silencios,
)
from app.util.units import (
    UI_MARGEN_MS_MAX,
    UI_MARGEN_MS_MIN,
    UI_UMBRAL_DB_MAX,
    UI_UMBRAL_DB_MIN,
)

# Mínimo 100 iteraciones por propiedad.
PBT = settings(max_examples=200, deadline=None)


class _RunnerGrabador:
    """Runner inyectable que registra las llamadas y simula éxito (returncode 0)."""

    def __init__(self, returncode: int = 0) -> None:
        self.returncode = returncode
        self.llamadas: List[List[str]] = []

    def __call__(self, args: Sequence[str]) -> ResultadoComando:
        self.llamadas.append(list(args))
        return ResultadoComando(returncode=self.returncode, args=list(args))


# Nombres de archivo seguros (sin separadores ni nulos) para las rutas.
_NOMBRE = st.text(
    alphabet=st.characters(whitelist_categories=("L", "N"), whitelist_characters="_-"),
    min_size=1,
    max_size=30,
).map(lambda s: s + ".mp4")


# ---------------------------------------------------------------------------
# Propiedad 9: El corte de silencios desactivado es un no-op
# Feature: vertical-shorts-editor, Property 9
# Validates: Requisitos 4.3
# ---------------------------------------------------------------------------
@PBT
@given(
    entrada=_NOMBRE,
    salida=_NOMBRE,
    umbral_db=st.floats(min_value=-200, max_value=200, allow_nan=False, allow_infinity=False),
    margen_ms=st.integers(min_value=-10000, max_value=10000),
)
def test_propiedad_9_corte_desactivado_es_noop(
    entrada: str, salida: str, umbral_db: float, margen_ms: int
) -> None:
    """Con el corte desactivado, la salida es idéntica a la entrada y no se
    ejecuta ``auto-editor`` (Req 4.3), sea cual sea el umbral/margen indicado."""
    runner = _RunnerGrabador()

    resultado = cortar_silencios(
        entrada,
        salida,
        activado=False,
        umbral_db=umbral_db,
        margen_ms=margen_ms,
        runner=runner,
    )

    # El video de salida del paso es idéntico al de entrada (misma ruta).
    assert resultado == Path(entrada)
    # No-op: no se construyó ni ejecutó ningún comando de auto-editor.
    assert runner.llamadas == []


# ---------------------------------------------------------------------------
# Propiedad 10: Validación de umbral/margen conserva el último valor válido
# Feature: vertical-shorts-editor, Property 10
# Validates: Requisitos 4.4
# ---------------------------------------------------------------------------
_UMBRAL_VALIDO = st.floats(
    min_value=UI_UMBRAL_DB_MIN,
    max_value=UI_UMBRAL_DB_MAX,
    allow_nan=False,
    allow_infinity=False,
)
_UMBRAL_INVALIDO = st.one_of(
    st.floats(
        min_value=UI_UMBRAL_DB_MAX + 0.001,
        max_value=UI_UMBRAL_DB_MAX + 500.0,
        allow_nan=False,
        allow_infinity=False,
    ),
    st.floats(
        min_value=UI_UMBRAL_DB_MIN - 500.0,
        max_value=UI_UMBRAL_DB_MIN - 0.001,
        allow_nan=False,
        allow_infinity=False,
    ),
)

_MARGEN_VALIDO = st.integers(min_value=int(UI_MARGEN_MS_MIN), max_value=int(UI_MARGEN_MS_MAX))
_MARGEN_INVALIDO = st.one_of(
    st.integers(min_value=int(UI_MARGEN_MS_MAX) + 1, max_value=int(UI_MARGEN_MS_MAX) + 50000),
    st.integers(min_value=int(UI_MARGEN_MS_MIN) - 50000, max_value=int(UI_MARGEN_MS_MIN) - 1),
)


@st.composite
def _secuencia_umbral(draw: st.DrawFn) -> List[Tuple[bool, float]]:
    """Genera una secuencia de actualizaciones (válida?, valor) del umbral."""
    n = draw(st.integers(min_value=1, max_value=15))
    seq: List[Tuple[bool, float]] = []
    for _ in range(n):
        if draw(st.booleans()):
            seq.append((True, draw(_UMBRAL_VALIDO)))
        else:
            seq.append((False, draw(_UMBRAL_INVALIDO)))
    return seq


@st.composite
def _secuencia_margen(draw: st.DrawFn) -> List[Tuple[bool, int]]:
    """Genera una secuencia de actualizaciones (válida?, valor) del margen."""
    n = draw(st.integers(min_value=1, max_value=15))
    seq: List[Tuple[bool, int]] = []
    for _ in range(n):
        if draw(st.booleans()):
            seq.append((True, draw(_MARGEN_VALIDO)))
        else:
            seq.append((False, draw(_MARGEN_INVALIDO)))
    return seq


@PBT
@given(inicial=_UMBRAL_VALIDO, actualizaciones=_secuencia_umbral())
def test_propiedad_10_umbral_conserva_ultimo_valido(
    inicial: float, actualizaciones: List[Tuple[bool, float]]
) -> None:
    """Cualquier umbral fuera de rango se rechaza y el valor conservado sigue
    siendo el último umbral válido (Req 4.4)."""
    validador = ValidadorSilencio(umbral_db=inicial)
    esperado = inicial
    assert validador.umbral_db == esperado

    for es_valido, valor in actualizaciones:
        if es_valido:
            validador.actualizar_umbral(valor)
            esperado = valor
        else:
            with pytest.raises(SilenceValidationError):
                validador.actualizar_umbral(valor)
        # Tras cada intento, el valor efectivo es el último válido.
        assert validador.umbral_db == esperado


@PBT
@given(inicial=_MARGEN_VALIDO, actualizaciones=_secuencia_margen())
def test_propiedad_10_margen_conserva_ultimo_valido(
    inicial: int, actualizaciones: List[Tuple[bool, int]]
) -> None:
    """Cualquier margen fuera de rango se rechaza y el valor conservado sigue
    siendo el último margen válido (Req 4.4)."""
    validador = ValidadorSilencio(margen_ms=inicial)
    esperado = inicial
    assert validador.margen_ms == esperado

    for es_valido, valor in actualizaciones:
        if es_valido:
            validador.actualizar_margen(valor)
            esperado = valor
        else:
            with pytest.raises(SilenceValidationError):
                validador.actualizar_margen(valor)
        assert validador.margen_ms == esperado


# ---------------------------------------------------------------------------
# Tests unitarios de apoyo
# ---------------------------------------------------------------------------
def test_cortar_silencios_activado_invoca_auto_editor() -> None:
    """Con el corte activado se ejecuta auto-editor y se devuelve la salida."""
    runner = _RunnerGrabador()
    resultado = cortar_silencios(
        "unido.mp4",
        "cortado.mp4",
        activado=True,
        umbral_db=-30.0,
        margen_ms=200,
        runner=runner,
    )
    assert resultado == Path("cortado.mp4")
    assert len(runner.llamadas) == 1
    comando = runner.llamadas[0]
    assert comando[0] == "auto-editor"
    assert "--no-open" in comando
    assert any("threshold=" in c for c in comando)
    assert "--margin" in comando


def test_cortar_silencios_falla_si_auto_editor_falla() -> None:
    """Si auto-editor devuelve código != 0 se lanza SilenceProcessingError (Req 4.5)."""
    runner = _RunnerGrabador(returncode=1)
    with pytest.raises(SilenceProcessingError):
        cortar_silencios(
            "unido.mp4",
            "cortado.mp4",
            activado=True,
            umbral_db=-30.0,
            margen_ms=200,
            runner=runner,
        )


def test_comando_auto_editor_incluye_umbral_y_margen() -> None:
    comando = comando_auto_editor("in.mp4", "out.mp4", 4.0, 0.2)
    assert comando[0] == "auto-editor"
    assert "audio:threshold=4%" in comando
    assert "0.2s" in comando
