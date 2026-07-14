"""Tests de la revisión manual de subtítulos (pausa/reanudación del pipeline).

Cubre:

* Que ``ejecutar_pipeline`` se **pausa** tras la transcripción cuando
  ``ajustes.subtitulos.revisar`` está activo, devolviendo ``pendiente_revision``
  con los grupos propuestos y el video ``cortado`` (sin quemar ni conservar).
* Que ``reanudar_pipeline`` completa la fase 2 usando los **grupos editados**
  (se los pasa a ``fn_subtitulos`` mediante el kwarg ``grupos``).
* Que sin la revisión manual (por defecto) el pipeline NO renderiza
  automáticamente: prepara los grupos finales y se pausa para la elección de
  motor (``pendiente_eleccion_render``), sin ``pendiente_revision`` (spec
  subtitulos-ia-remotion, tarea 8.2).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, List

from app import config
from app.engine.pipeline import ejecutar_pipeline, reanudar_pipeline
from app.models.settings import (
    Ajustes,
    AjustesSubtitulos,
    GrupoSubtitulo,
    Palabra,
)
from app.storage.workdir import JobWorkdir


# ---------------------------------------------------------------------------
# Dobles de los pasos del pipeline
# ---------------------------------------------------------------------------
def _fake_unir(job, orden_clips, ancho, alto, fps, *, runner, inspector) -> Path:
    return job.resolve("unido.mp4")


def _fake_cortar(unido, salida, *, activado, umbral_db, margen_ms, runner) -> Path:
    return Path(unido)


def _fake_transcribir(cortado, ajustes_transc, audio, *, runner) -> List[Palabra]:
    return [
        Palabra(texto="hola", inicio_s=0.0, fin_s=0.5),
        Palabra(texto="mundo", inicio_s=0.5, fin_s=1.0),
    ]


class _SubtitulosSpy:
    """Doble de fn_subtitulos que registra los grupos recibidos."""

    def __init__(self) -> None:
        self.grupos_recibidos: Any = "no-invocado"

    def __call__(
        self, cortado, palabras, subtitulos, resolucion, ass_path, salida,
        *, runner, existe_salida, grupos=None,
    ) -> Path:
        self.grupos_recibidos = grupos
        return Path(salida)


def _fake_preservar(job: JobWorkdir, ruta_temporal) -> Path:
    return Path(ruta_temporal)


def _hacer_job(tmp_path: Path, monkeypatch, nombre: str) -> JobWorkdir:
    monkeypatch.setattr(config, "WORKDIR_ROOT", tmp_path / "wk")
    monkeypatch.setattr(config, "OUTPUT_ROOT", tmp_path / "out")
    return JobWorkdir(nombre)


def test_pipeline_se_pausa_para_revision(tmp_path: Path, monkeypatch) -> None:
    job = _hacer_job(tmp_path, monkeypatch, "job-rev")
    spy = _SubtitulosSpy()
    # Corte de silencios desactivado (Req 1.5): estos tests ejercitan la revisión
    # de subtítulos, no la pausa de edición de silencios.
    ajustes = Ajustes(subtitulos=AjustesSubtitulos(revisar=True))
    ajustes.silencios.activado = False

    resultado = ejecutar_pipeline(
        job,
        ["/clips/a.mp4"],
        ajustes,
        musica_wav=None,
        fn_unir=_fake_unir,
        fn_cortar=_fake_cortar,
        fn_transcribir=_fake_transcribir,
        fn_subtitulos=spy,
        fn_preservar=_fake_preservar,
    )

    assert resultado.pendiente_revision is True
    assert resultado.exito is False
    assert resultado.grupos is not None and len(resultado.grupos) == 1
    assert resultado.grupos[0].texto == "hola mundo"
    assert resultado.cortado is not None
    # No se quemaron subtítulos durante la fase 1.
    assert spy.grupos_recibidos == "no-invocado"


def test_reanudar_aplica_grupos_editados(tmp_path: Path, monkeypatch) -> None:
    job = _hacer_job(tmp_path, monkeypatch, "job-rev2")
    spy = _SubtitulosSpy()
    ajustes = Ajustes(subtitulos=AjustesSubtitulos(revisar=True))

    editados = [GrupoSubtitulo(texto="Hola Mundo!", inicio_s=0.0, fin_s=1.0)]

    resultado = reanudar_pipeline(
        job,
        job.resolve("cortado.mp4"),
        ajustes,
        palabras=[],
        grupos=editados,
        # Motor "ass" explícito: el valor por defecto del render es ahora
        # "remotion" (spec edicion-avanzada-shorts); este test verifica que los
        # grupos editados llegan al quemado ASS.
        motor="ass",
        musica_wav=None,
        fn_subtitulos=spy,
        fn_preservar=_fake_preservar,
    )

    assert resultado.exito is True
    # fn_subtitulos recibió exactamente los grupos editados.
    assert spy.grupos_recibidos == editados


def test_sin_revision_corre_completo(tmp_path: Path, monkeypatch) -> None:
    job = _hacer_job(tmp_path, monkeypatch, "job-norev")
    spy = _SubtitulosSpy()
    ajustes = Ajustes()  # revisar por defecto False
    ajustes.silencios.activado = False  # sin pausa de edición de silencios (Req 1.5)

    resultado = ejecutar_pipeline(
        job,
        ["/clips/a.mp4"],
        ajustes,
        musica_wav=None,
        fn_unir=_fake_unir,
        fn_cortar=_fake_cortar,
        fn_transcribir=_fake_transcribir,
        fn_subtitulos=spy,
        fn_preservar=_fake_preservar,
    )

    # Sin revisión manual, el pipeline ya NO renderiza automáticamente: prepara
    # los grupos finales y se pausa en la edición final (spec
    # edicion-avanzada-shorts; antes "elección de motor").
    assert resultado.pendiente_revision is False
    assert resultado.pendiente_eleccion_render is True
    assert resultado.exito is False
    # En la fase 1 NO se queman subtítulos (se pausa antes del render).
    assert spy.grupos_recibidos == "no-invocado"
    # Los grupos finales quedan disponibles para la elección de motor.
    assert resultado.grupos is not None and len(resultado.grupos) == 1
    assert resultado.grupos[0].texto == "hola mundo"
    assert resultado.cortado is not None
