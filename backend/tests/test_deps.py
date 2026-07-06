"""Tests del Verificador de Dependencias (Tarea 10, Req 12.1-12.5).

Contiene:

* **Propiedad 25** (Feature: vertical-shorts-editor, Property 25): para cualquier
  subconjunto de dependencias faltantes entre {ffmpeg, ffprobe, auto-editor,
  faster-whisper}, el verificador reporta por nombre **exactamente** ese
  subconjunto y bloquea el arranque **si y solo si** el subconjunto es no vacío.
  (Validates: Requisitos 12.2, 12.4, 12.5)
* Tests unitarios del **timeout** de comprobación: una comprobación que excede su
  plazo se marca como **no verificable / no disponible** (Validates: Req 12.1,
  12.3), tanto por ``TimeoutExpired`` de un comprobador individual como por
  agotamiento del presupuesto total de 10 s.

Los comprobadores se inyectan (no se depende de los binarios reales ffmpeg /
ffprobe / auto-editor ni del paquete faster-whisper instalado).
"""

from __future__ import annotations

import subprocess
from typing import Dict, List, Set

from hypothesis import given, settings
from hypothesis import strategies as st

from app import config
from app.deps.checker import (
    DEPENDENCIAS,
    Comprobador,
    DependenciasFaltantesError,
    ResultadoVerificacion,
    comprobar_binario,
    verificar_dependencias,
)

# Mínimo 100 iteraciones por propiedad.
PBT = settings(max_examples=150, deadline=None)


def _comprobadores_desde_faltantes(faltantes: Set[str]) -> Dict[str, Comprobador]:
    """Construye un mapeo de comprobadores donde las dependencias en ``faltantes``
    no están disponibles y el resto sí, sin ejecutar binarios reales."""

    def _hacer(nombre: str) -> Comprobador:
        disponible = nombre not in faltantes

        def _comprobar(_timeout: float) -> bool:
            return disponible

        return _comprobar

    return {nombre: _hacer(nombre) for nombre in DEPENDENCIAS}


# ---------------------------------------------------------------------------
# Propiedad 25: Decisión del verificador de dependencias
# Feature: vertical-shorts-editor, Property 25
# Validates: Requisitos 12.2, 12.4, 12.5
# ---------------------------------------------------------------------------
@PBT
@given(faltantes=st.sets(st.sampled_from(DEPENDENCIAS)))
def test_propiedad_25_decision_del_verificador(faltantes: Set[str]) -> None:
    """Para cualquier subconjunto de dependencias faltantes, el verificador:

    * reporta por nombre **exactamente** ese subconjunto (Req 12.2), y
    * bloquea el arranque **si y solo si** el subconjunto es no vacío
      (Req 12.4 cuando falta alguna, Req 12.5 cuando no falta ninguna).
    """
    comprobadores = _comprobadores_desde_faltantes(faltantes)

    resultado = verificar_dependencias(comprobadores=comprobadores)

    # Reporta por nombre exactamente el subconjunto faltante.
    assert set(resultado.faltantes) == faltantes
    # Sin duplicados y solo nombres válidos.
    assert len(resultado.faltantes) == len(faltantes)
    assert set(resultado.faltantes).issubset(set(DEPENDENCIAS))

    # Bloquea si y solo si el subconjunto es no vacío.
    assert resultado.debe_bloquear == bool(faltantes)
    assert resultado.ok == (not faltantes)


@PBT
@given(faltantes=st.sets(st.sampled_from(DEPENDENCIAS)))
def test_propiedad_25_arranque_aborta_sii_falta_alguna(faltantes: Set[str]) -> None:
    """El arranque (lanzar :class:`DependenciasFaltantesError`) ocurre si y solo si
    falta alguna dependencia, y el error identifica exactamente las faltantes."""
    comprobadores = _comprobadores_desde_faltantes(faltantes)
    resultado = verificar_dependencias(comprobadores=comprobadores)

    if faltantes:
        error = DependenciasFaltantesError(resultado.faltantes)
        assert set(error.faltantes) == faltantes
        # El mensaje nombra cada dependencia faltante (Req 12.2).
        for nombre in faltantes:
            assert nombre in str(error)
    else:
        # Con todo disponible no debe bloquearse (Req 12.5).
        assert not resultado.debe_bloquear


# ---------------------------------------------------------------------------
# Tarea 10.4: Timeout de comprobación de dependencia
# Validates: Requisitos 12.1, 12.3
# ---------------------------------------------------------------------------
def test_timeout_individual_marca_no_verificable_y_no_disponible() -> None:
    """Una comprobación que excede su plazo (``TimeoutExpired``) se trata como no
    verificable y, por tanto, no disponible (Req 12.3)."""

    def _lento(timeout: float) -> bool:
        raise subprocess.TimeoutExpired(cmd="ffmpeg --version", timeout=timeout)

    comprobadores: Dict[str, Comprobador] = {
        "ffmpeg": _lento,
        "ffprobe": lambda _t: True,
        "auto-editor": lambda _t: True,
        "faster-whisper": lambda _t: True,
    }

    resultado = verificar_dependencias(comprobadores=comprobadores)

    ffmpeg = next(r for r in resultado.resultados if r.nombre == "ffmpeg")
    assert ffmpeg.verificable is False
    assert ffmpeg.disponible is False
    # No verificable => contabilizada como faltante y bloquea el arranque.
    assert "ffmpeg" in resultado.faltantes
    assert "ffmpeg" in resultado.no_verificables
    assert resultado.debe_bloquear is True


def test_timeout_error_generico_tambien_marca_no_verificable() -> None:
    """Un ``TimeoutError`` genérico también marca la dependencia como no verificable."""

    def _lento(_timeout: float) -> bool:
        raise TimeoutError("la comprobación tardó demasiado")

    comprobadores: Dict[str, Comprobador] = {
        nombre: (lambda _t: True) for nombre in DEPENDENCIAS
    }
    comprobadores["faster-whisper"] = _lento

    resultado = verificar_dependencias(comprobadores=comprobadores)

    fw = next(r for r in resultado.resultados if r.nombre == "faster-whisper")
    assert fw.verificable is False
    assert fw.disponible is False
    assert resultado.debe_bloquear is True


def test_agotamiento_del_presupuesto_total_marca_no_verificable() -> None:
    """Si el plazo total de 10 s se agota, las comprobaciones restantes se marcan
    como no verificables (Req 12.1, 12.3)."""
    # Reloj simulado: cada llamada avanza 6 s. Tras la primera comprobación el
    # tiempo transcurrido supera el plazo total, por lo que las siguientes
    # dependencias quedan sin presupuesto.
    tiempos = iter([0.0, 6.0, 12.0, 18.0, 24.0, 30.0, 36.0])

    def _reloj() -> float:
        return next(tiempos)

    comprobadores: Dict[str, Comprobador] = {
        nombre: (lambda _t: True) for nombre in DEPENDENCIAS
    }

    resultado = verificar_dependencias(
        comprobadores=comprobadores,
        timeout_total=config.DEPENDENCY_CHECK_TIMEOUT_S,
        reloj=_reloj,
    )

    # La primera dependencia sí se verifica; las siguientes se quedan sin plazo.
    assert resultado.resultados[0].nombre == DEPENDENCIAS[0]
    assert resultado.resultados[0].disponible is True
    for r in resultado.resultados[1:]:
        assert r.verificable is False
        assert r.disponible is False
    assert resultado.debe_bloquear is True


def test_todo_disponible_permite_el_arranque() -> None:
    """Cuando todas las dependencias están disponibles, no se bloquea (Req 12.5)."""
    comprobadores: Dict[str, Comprobador] = {
        nombre: (lambda _t: True) for nombre in DEPENDENCIAS
    }
    resultado = verificar_dependencias(comprobadores=comprobadores)
    assert isinstance(resultado, ResultadoVerificacion)
    assert resultado.ok is True
    assert resultado.faltantes == []
    assert resultado.debe_bloquear is False


def test_comprobar_binario_detecta_ejecutable_ausente() -> None:
    """El comprobador de binarios trata un ejecutable inexistente como no disponible."""
    comando_inexistente = "binario-que-no-existe-vse-xyz"
    comprobadores: Dict[str, Comprobador] = {
        nombre: (lambda _t: True) for nombre in DEPENDENCIAS
    }
    comprobadores["ffmpeg"] = comprobar_binario(comando_inexistente)

    resultado = verificar_dependencias(comprobadores=comprobadores)

    ffmpeg = next(r for r in resultado.resultados if r.nombre == "ffmpeg")
    assert ffmpeg.disponible is False
    # Ejecutable ausente es "no disponible" pero sí verificable (no es timeout).
    assert ffmpeg.verificable is True
    assert "ffmpeg" in resultado.faltantes
