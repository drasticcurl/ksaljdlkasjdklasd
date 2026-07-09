"""Tests del flujo de revisión de subtítulos y duración mínima de silencio.

Cubre:

* **Pipeline en dos fases** (`procesar_hasta_agrupar` + `finalizar_render`) con
  dobles inyectados: la Fase A devuelve grupos + ruta_cortado y reporta hasta
  ~70 %; la Fase B quema subtítulos → música → preserva y llega a COMPLETADO.
* **Runner en modo revisión**: con `revisar_antes_de_renderizar=True` el Job se
  pausa en ESPERANDO_REVISION SIN limpiar el workdir; `reanudar_job` corre la
  Fase B, marca COMPLETADO y limpia.
* **Endpoints** `GET/POST /subtitulos/{id}`: revisión OK, 404 inexistente,
  409 si no está en revisión.
* **Validación** de `min_silencio_ms` y `revisar_antes_de_renderizar`.
* **Silencios**: `cortar_silencios_ffmpeg` respeta `min_silencio_s` (d= del
  filtro) y `cortar_silencios` traslada `min_silencio_ms`.
"""

from __future__ import annotations

import shutil
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Dict, Iterator, List, Optional

from fastapi.testclient import TestClient

import main
from app import config
from app.engine.pipeline import finalizar_render, procesar_hasta_agrupar
from app.engine.proc import ResultadoComando
from app.engine.silence import cortar_silencios, cortar_silencios_ffmpeg
from app.jobs.manager import JobManager
from app.jobs.runner import JobRunner
from app.models.job import JobStatus, PipelineStep
from app.models.settings import (
    Ajustes,
    AjustesMusica,
    GrupoSubtitulo,
    validar_ajustes,
)
from app.storage.workdir import JobWorkdir
from app.api import process as process_api
from app.deps import checker as _deps_checker


# ---------------------------------------------------------------------------
# Utilidades de configuración aislada
# ---------------------------------------------------------------------------
@contextmanager
def isolated_config_dirs() -> Iterator[None]:
    old_work = config.WORKDIR_ROOT
    old_out = config.OUTPUT_ROOT
    base = Path(tempfile.mkdtemp(prefix="vse_review_test_"))
    config.WORKDIR_ROOT = (base / "work").resolve()
    config.OUTPUT_ROOT = (base / "out").resolve()
    try:
        yield
    finally:
        config.WORKDIR_ROOT = old_work
        config.OUTPUT_ROOT = old_out
        shutil.rmtree(base, ignore_errors=True)


def _ajustes(revisar: bool = True, con_musica: bool = False) -> Ajustes:
    ajustes = Ajustes(musica=AjustesMusica() if con_musica else None)
    ajustes.subtitulos.revisar_antes_de_renderizar = revisar
    return ajustes


# ---------------------------------------------------------------------------
# Dobles de los pasos del pipeline
# ---------------------------------------------------------------------------
def _construir_fakes(recorder: List[str]) -> Dict[str, object]:
    def fn_unir(job, orden, ancho, alto, fps, **kw) -> Path:  # noqa: ANN001
        recorder.append(PipelineStep.UNIR.value)
        return job.resolve("unido.mp4")

    def fn_cortar(entrada, salida, **kw) -> Path:  # noqa: ANN001
        recorder.append(PipelineStep.CORTAR_SILENCIOS.value)
        return Path(salida)

    def fn_transcribir(entrada, ajustes_t, audio, **kw) -> List:  # noqa: ANN001
        recorder.append(PipelineStep.TRANSCRIBIR.value)
        # Palabras simuladas: dos palabras con timestamps válidos.
        from app.models.settings import Palabra

        return [
            Palabra(texto="hola", inicio_s=0.0, fin_s=0.5),
            Palabra(texto="mundo", inicio_s=0.5, fin_s=1.0),
        ]

    def fn_subtitulos(entrada, grupos, sub, res, ass, salida, **kw) -> Path:  # noqa: ANN001
        recorder.append(PipelineStep.SUBTITULOS.value)
        # Registra los grupos recibidos para verificar la edición.
        recorder.append("GRUPOS:" + "|".join(getattr(g, "texto", g.get("texto", "")) if not isinstance(g, GrupoSubtitulo) else g.texto for g in grupos))
        return Path(salida)

    def fn_musica(entrada, mwav, mus, salida, **kw) -> Path:  # noqa: ANN001
        recorder.append(PipelineStep.MUSICA.value)
        return Path(salida)

    def fn_preservar(job, tmp) -> Path:  # noqa: ANN001
        return job.output_path

    return dict(
        fn_unir=fn_unir,
        fn_cortar=fn_cortar,
        fn_transcribir=fn_transcribir,
        fn_subtitulos=fn_subtitulos,
        fn_musica=fn_musica,
        fn_preservar=fn_preservar,
    )


# ===========================================================================
# Pipeline en dos fases
# ===========================================================================
def test_fase_a_devuelve_grupos_y_ruta_cortado() -> None:
    """La Fase A ejecuta UNIR→CORTAR→TRANSCRIBIR→agrupar y devuelve grupos +
    ruta_cortado, reportando hasta ~70 %."""
    with isolated_config_dirs():
        recorder: List[str] = []
        fakes = _construir_fakes(recorder)
        job = JobWorkdir("job-fasea")
        eventos = []

        resultado = procesar_hasta_agrupar(
            job, ["a"], _ajustes(revisar=True), reporter=eventos.append, **fakes
        )

        assert resultado.exito is True
        assert resultado.ruta_cortado is not None
        # Se agruparon las dos palabras (max_palabras por defecto = 4 → un grupo).
        assert len(resultado.grupos) == 1
        assert resultado.grupos[0].texto == "hola mundo"
        # No se ejecutó la Fase B (sin subtítulos ni música).
        assert PipelineStep.SUBTITULOS.value not in recorder
        # El progreso llegó al borde superior de TRANSCRIBIR (70 %).
        assert max(e.porcentaje for e in eventos) == 70


def test_fase_b_quema_desde_grupos_y_completa() -> None:
    """La Fase B usa los grupos provistos (editados) y llega a COMPLETADO."""
    with isolated_config_dirs():
        recorder: List[str] = []
        fakes = _construir_fakes(recorder)
        job = JobWorkdir("job-faseb")
        job.create()
        eventos = []

        grupos = [GrupoSubtitulo(texto="texto editado", inicio_s=0.0, fin_s=1.0)]
        resultado = finalizar_render(
            job,
            _ajustes(revisar=True),
            grupos,
            str(job.resolve("cortado.mp4")),
            reporter=eventos.append,
            **fakes,
        )

        assert resultado.exito is True
        assert PipelineStep.SUBTITULOS.value in recorder
        # Fase B recibió los grupos editados.
        assert "GRUPOS:texto editado" in recorder
        assert any(e.estado == JobStatus.COMPLETADO for e in eventos)


def test_fase_a_falla_detiene() -> None:
    """Si un paso de la Fase A falla, se devuelve exito=False con el paso."""
    with isolated_config_dirs():
        recorder: List[str] = []
        fakes = _construir_fakes(recorder)

        def fn_unir_falla(job, orden, ancho, alto, fps, **kw):  # noqa: ANN001
            raise RuntimeError("boom UNIR")

        fakes["fn_unir"] = fn_unir_falla
        job = JobWorkdir("job-fasea-falla")

        resultado = procesar_hasta_agrupar(job, ["a"], _ajustes(), **fakes)
        assert resultado.exito is False
        assert resultado.paso_fallido == PipelineStep.UNIR


# ===========================================================================
# Runner en modo revisión
# ===========================================================================
def test_runner_pausa_en_revision_sin_limpiar() -> None:
    """Con revisar=True, el runner corre la Fase A, marca ESPERANDO_REVISION y
    NO limpia el workdir (debe persistir para la Fase B)."""
    with isolated_config_dirs():
        manager = JobManager()
        manager.crear_job("job-rev", ["a"], _ajustes(revisar=True), workdir="wd")
        recorder: List[str] = []
        runner = JobRunner(manager, **_construir_fakes(recorder))

        resultado = runner.ejecutar_job("job-rev")

        assert resultado.exito is True
        job = manager.obtener("job-rev")
        assert job.progreso.estado == JobStatus.ESPERANDO_REVISION
        # Grupos y ruta_cortado guardados.
        assert job.grupos and job.grupos[0]["texto"] == "hola mundo"
        assert job.ruta_cortado is not None
        # El workdir NO se limpió (persiste para la Fase B).
        assert JobWorkdir("job-rev").root.exists()
        # No se ejecutó la Fase B todavía.
        assert PipelineStep.SUBTITULOS.value not in recorder


def test_runner_reanudar_corre_fase_b_y_limpia() -> None:
    """`reanudar_job` con grupos editados corre la Fase B, marca COMPLETADO y
    limpia el workdir."""
    with isolated_config_dirs():
        manager = JobManager()
        manager.crear_job("job-rev2", ["a"], _ajustes(revisar=True), workdir="wd")
        recorder: List[str] = []
        runner = JobRunner(manager, **_construir_fakes(recorder))

        runner.ejecutar_job("job-rev2")
        assert manager.obtener("job-rev2").progreso.estado == JobStatus.ESPERANDO_REVISION

        # El usuario edita el texto del grupo.
        editados = [{"texto": "corregido", "inicio_s": 0.0, "fin_s": 1.0}]
        resultado = runner.reanudar_job("job-rev2", editados)

        assert resultado.exito is True
        prog = manager.obtener("job-rev2").progreso
        assert prog.estado == JobStatus.COMPLETADO
        assert prog.porcentaje == 100
        # La Fase B usó el texto editado.
        assert "GRUPOS:corregido" in recorder
        # El workdir se limpió tras completar la Fase B.
        assert not JobWorkdir("job-rev2").root.exists()


def test_runner_reanudar_falla_si_no_esta_en_revision() -> None:
    """`reanudar_job` sobre un Job que no está en revisión lanza ValueError."""
    with isolated_config_dirs():
        manager = JobManager()
        manager.crear_job("job-norev", ["a"], _ajustes(revisar=True), workdir="wd")
        runner = JobRunner(manager, **_construir_fakes([]))

        # Sin haber corrido la Fase A: sigue EN_COLA.
        try:
            runner.reanudar_job("job-norev", [])
            raise AssertionError("Se esperaba ValueError")
        except ValueError:
            pass


def test_runner_sin_revision_completa_directo() -> None:
    """Con revisar=False el runner renderiza directamente hasta COMPLETADO."""
    with isolated_config_dirs():
        manager = JobManager()
        manager.crear_job("job-directo", ["a"], _ajustes(revisar=False), workdir="wd")
        recorder: List[str] = []
        runner = JobRunner(manager, **_construir_fakes(recorder))

        resultado = runner.ejecutar_job("job-directo")

        assert resultado.exito is True
        assert manager.obtener("job-directo").progreso.estado == JobStatus.COMPLETADO
        # Se ejecutaron ambas fases (incluida SUBTITULOS).
        assert PipelineStep.SUBTITULOS.value in recorder
        assert not JobWorkdir("job-directo").root.exists()


# ===========================================================================
# Endpoints GET/POST /subtitulos/{id}
# ===========================================================================
def _verificacion_ok(*_a, **_k):
    return _deps_checker.ResultadoVerificacion(
        resultados=[
            _deps_checker.ResultadoDependencia(nombre=n, disponible=True)
            for n in _deps_checker.DEPENDENCIAS
        ]
    )


@contextmanager
def _cliente(manager: JobManager, runner: Optional[JobRunner] = None):
    ejecutor = runner if runner is not None else JobRunner(manager, **_construir_fakes([]))
    main.verificar_dependencias = _verificacion_ok  # type: ignore[assignment]
    main.app.dependency_overrides[process_api.obtener_gestor_jobs] = lambda: manager
    main.app.dependency_overrides[process_api.obtener_job_runner] = lambda: ejecutor
    try:
        yield TestClient(main.app)
    finally:
        main.app.dependency_overrides.pop(process_api.obtener_gestor_jobs, None)
        main.app.dependency_overrides.pop(process_api.obtener_job_runner, None)


def test_get_subtitulos_en_revision_devuelve_grupos() -> None:
    manager = JobManager()
    manager.crear_job("job-g", ["a"], _ajustes(revisar=True), workdir="wd")
    manager.marcar_esperando_revision(
        "job-g",
        grupos=[{"texto": "linea uno", "inicio_s": 0.0, "fin_s": 1.0}],
        ruta_cortado="/tmp/cortado.mp4",
    )
    with _cliente(manager) as client:
        resp = client.get("/subtitulos/job-g")
        assert resp.status_code == 200, resp.text
        grupos = resp.json()["grupos"]
        assert grupos == [
            {"indice": 0, "texto": "linea uno", "inicio_s": 0.0, "fin_s": 1.0}
        ]


def test_get_subtitulos_inexistente_404() -> None:
    with _cliente(JobManager()) as client:
        resp = client.get("/subtitulos/no-existe")
        assert resp.status_code == 404
        assert resp.json()["error"]["code"] == "JOB_NOT_FOUND"


def test_get_subtitulos_no_en_revision_409() -> None:
    manager = JobManager()
    manager.crear_job("job-cola", ["a"], _ajustes(revisar=True), workdir="wd")
    with _cliente(manager) as client:
        resp = client.get("/subtitulos/job-cola")
        assert resp.status_code == 409
        assert resp.json()["error"]["code"] == "NOT_IN_REVIEW"


def test_post_subtitulos_reanuda_y_responde_202() -> None:
    with isolated_config_dirs():
        manager = JobManager()
        manager.crear_job("job-p", ["a"], _ajustes(revisar=True), workdir="wd")
        recorder: List[str] = []
        runner = JobRunner(manager, **_construir_fakes(recorder))
        # Correr Fase A para dejar el Job en revisión.
        runner.ejecutar_job("job-p")
        assert manager.obtener("job-p").progreso.estado == JobStatus.ESPERANDO_REVISION

        with _cliente(manager, runner=runner) as client:
            resp = client.post(
                "/subtitulos/job-p",
                json={"grupos": [{"texto": "editado", "inicio_s": 0.0, "fin_s": 1.0}]},
            )
            assert resp.status_code == 202, resp.text
            assert resp.json() == {"job_id": "job-p", "estado": "en_ejecucion"}

        # Tras reanudar en background (el TestClient corre el executor), el Job
        # completa con el texto editado.
        prog = manager.obtener("job-p").progreso
        assert prog.estado == JobStatus.COMPLETADO
        assert "GRUPOS:editado" in recorder


def test_post_subtitulos_inexistente_404() -> None:
    with _cliente(JobManager()) as client:
        resp = client.post("/subtitulos/no-existe", json={"grupos": []})
        assert resp.status_code == 404
        assert resp.json()["error"]["code"] == "JOB_NOT_FOUND"


def test_post_subtitulos_no_en_revision_409() -> None:
    manager = JobManager()
    manager.crear_job("job-cola2", ["a"], _ajustes(revisar=True), workdir="wd")
    with _cliente(manager) as client:
        resp = client.post("/subtitulos/job-cola2", json={"grupos": []})
        assert resp.status_code == 409
        assert resp.json()["error"]["code"] == "NOT_IN_REVIEW"


def test_post_subtitulos_sin_grupos_400() -> None:
    manager = JobManager()
    manager.crear_job("job-b", ["a"], _ajustes(revisar=True), workdir="wd")
    manager.marcar_esperando_revision(
        "job-b", grupos=[], ruta_cortado="/tmp/c.mp4"
    )
    with _cliente(manager) as client:
        resp = client.post("/subtitulos/job-b", json={})
        assert resp.status_code == 400
        assert resp.json()["error"]["code"] == "INVALID_REQUEST"


# ===========================================================================
# Validación de min_silencio_ms y revisar_antes_de_renderizar
# ===========================================================================
def test_min_silencio_ms_default_y_rango() -> None:
    """El default de min_silencio_ms es 300 y su rango del motor es 0..5000."""
    ajustes = Ajustes()
    assert ajustes.silencios.min_silencio_ms == 300
    assert validar_ajustes(ajustes) == []


def test_min_silencio_ms_fuera_de_rango_se_rechaza() -> None:
    ajustes = Ajustes()
    ajustes.silencios.min_silencio_ms = 6000  # > 5000
    assert "silencios.min_silencio_ms" in validar_ajustes(ajustes)
    ajustes.silencios.min_silencio_ms = -1  # < 0
    assert "silencios.min_silencio_ms" in validar_ajustes(ajustes)


def test_revisar_antes_de_renderizar_default_true_no_afecta_validacion() -> None:
    """El flag es booleano, con default True, y no es motivo de rechazo."""
    ajustes = Ajustes()
    assert ajustes.subtitulos.revisar_antes_de_renderizar is True
    assert validar_ajustes(ajustes) == []
    ajustes.subtitulos.revisar_antes_de_renderizar = False
    assert validar_ajustes(ajustes) == []


# ===========================================================================
# min_silencio_s trasladado al filtro silencedetect
# ===========================================================================
class _RunnerSecuencia:
    def __init__(self, stderr_detect: str, duracion: str) -> None:
        self.stderr_detect = stderr_detect
        self.duracion = duracion
        self.comandos: List[List[str]] = []

    def __call__(self, args) -> ResultadoComando:  # noqa: ANN001
        args = list(args)
        self.comandos.append(args)
        if args[0] == "ffprobe":
            return ResultadoComando(returncode=0, stdout=self.duracion, args=args)
        if "silencedetect" in " ".join(args):
            return ResultadoComando(returncode=0, stderr=self.stderr_detect, args=args)
        return ResultadoComando(returncode=0, stderr="", args=args)


def test_cortar_ffmpeg_usa_min_silencio_s(tmp_path: Path) -> None:
    """`cortar_silencios_ffmpeg` usa el min_silencio_s provisto en d= del filtro."""
    runner = _RunnerSecuencia(stderr_detect="", duracion="10.0")
    cortar_silencios_ffmpeg(
        tmp_path / "in.mp4", tmp_path / "out.mp4", -30.0, 200, min_silencio_s=0.3, runner=runner
    )
    detect = next(c for c in runner.comandos if "silencedetect" in " ".join(c))
    idx = detect.index("-af")
    assert "d=0.3" in detect[idx + 1]


def test_cortar_ffmpeg_min_silencio_s_fallback(tmp_path: Path) -> None:
    """Sin min_silencio_s se usa el fallback config.DEFAULT_MIN_SILENCIO_S (0.5)."""
    runner = _RunnerSecuencia(stderr_detect="", duracion="10.0")
    cortar_silencios_ffmpeg(
        tmp_path / "in.mp4", tmp_path / "out.mp4", -30.0, 200, runner=runner
    )
    detect = next(c for c in runner.comandos if "silencedetect" in " ".join(c))
    idx = detect.index("-af")
    assert "d=0.5" in detect[idx + 1]


def test_cortar_silencios_traslada_min_silencio_ms(tmp_path: Path) -> None:
    """`cortar_silencios` convierte min_silencio_ms (ms) a s para el motor ffmpeg."""
    runner = _RunnerSecuencia(stderr_detect="", duracion="8.0")
    cortar_silencios(
        tmp_path / "in.mp4",
        tmp_path / "out.mp4",
        activado=True,
        umbral_db=-30.0,
        margen_ms=200,
        min_silencio_ms=250,
        runner=runner,
    )
    detect = next(c for c in runner.comandos if "silencedetect" in " ".join(c))
    idx = detect.index("-af")
    assert "d=0.25" in detect[idx + 1]
