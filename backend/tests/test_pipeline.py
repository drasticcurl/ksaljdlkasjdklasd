"""Tests de orquestación del pipeline — fail-soft de subtítulos (Req 10.7).

Verifica el modo ``VSE_SUBTITLES_FAILSOFT``:

* Con la variable activada, si el paso de subtítulos lanza ``SubtitulosError`` el
  pipeline **continúa con éxito** usando el video de entrada del paso (sin
  subtítulos).
* Sin la variable, el mismo fallo hace que el Job termine como **fallido**
  (comportamiento por defecto).

Los pasos del pipeline se inyectan como dobles para no depender de binarios.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, List

import pytest

from app import config
from app.engine.pipeline import ejecutar_pipeline
from app.engine.subtitles import SubtitulosError
from app.models.job import JobStatus, PipelineStep
from app.models.settings import Ajustes
from app.storage.workdir import JobWorkdir


# ---------------------------------------------------------------------------
# Dobles de los pasos del pipeline
# ---------------------------------------------------------------------------
def _fake_unir(job: JobWorkdir, orden_clips, ancho, alto, fps, *, runner, inspector) -> Path:
    return job.resolve("unido.mp4")


def _fake_cortar(unido, salida, *, activado, umbral_db, margen_ms, runner, **kw) -> Path:
    return Path(unido)


def _fake_transcribir(cortado, ajustes_transc, audio, *, runner) -> List[Any]:
    return []


def _fake_subtitulos_falla(
    cortado, palabras, subtitulos, resolucion, ass_path, salida, *, runner, existe_salida
) -> Path:
    raise SubtitulosError("ffmpeg falló al quemar subtítulos: boom")


def _fake_preservar(job: JobWorkdir, ruta_temporal) -> Path:
    return Path(ruta_temporal)


def _hacer_job(tmp_path: Path, monkeypatch, nombre: str) -> JobWorkdir:
    monkeypatch.setattr(config, "WORKDIR_ROOT", tmp_path / "wk")
    monkeypatch.setattr(config, "OUTPUT_ROOT", tmp_path / "out")
    job = JobWorkdir(nombre)
    return job


def _ejecutar(job: JobWorkdir):
    eventos = []
    resultado = ejecutar_pipeline(
        job,
        ["/clips/a.mp4"],
        Ajustes(),
        musica_wav=None,
        reporter=eventos.append,
        fn_unir=_fake_unir,
        fn_cortar=_fake_cortar,
        fn_transcribir=_fake_transcribir,
        fn_subtitulos=_fake_subtitulos_falla,
        fn_preservar=_fake_preservar,
    )
    return resultado, eventos


def test_failsoft_activo_continua_sin_subtitulos(tmp_path: Path, monkeypatch) -> None:
    """Con VSE_SUBTITLES_FAILSOFT=1, el fallo de subtítulos no aborta el pipeline."""
    monkeypatch.setenv("VSE_SUBTITLES_FAILSOFT", "1")
    job = _hacer_job(tmp_path, monkeypatch, "job-failsoft-on")

    resultado, eventos = _ejecutar(job)

    assert resultado.exito is True
    # El pipeline llegó al estado COMPLETADO.
    assert any(e.estado == JobStatus.COMPLETADO for e in eventos)
    # No hubo evento FALLIDO.
    assert not any(e.estado == JobStatus.FALLIDO for e in eventos)


def test_sin_failsoft_el_fallo_de_subtitulos_aborta(tmp_path: Path, monkeypatch) -> None:
    """Sin la env, el fallo de subtítulos marca el Job como fallido (Req 10.7)."""
    monkeypatch.delenv("VSE_SUBTITLES_FAILSOFT", raising=False)
    job = _hacer_job(tmp_path, monkeypatch, "job-failsoft-off")

    resultado, eventos = _ejecutar(job)

    assert resultado.exito is False
    assert resultado.paso_fallido == PipelineStep.SUBTITULOS
    # Se reportó un evento FALLIDO con el paso SUBTITULOS.
    fallidos = [e for e in eventos if e.estado == JobStatus.FALLIDO]
    assert fallidos and fallidos[-1].error["paso"] == PipelineStep.SUBTITULOS.value
