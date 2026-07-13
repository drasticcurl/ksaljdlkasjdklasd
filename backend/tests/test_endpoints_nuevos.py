"""Tests de los endpoints nuevos: /subtitulos/{id} y /configuracion.

Usan ``fastapi.testclient.TestClient`` con la verificación de dependencias del
arranque sustituida por un doble que siempre pasa, y el Gestor/ejecutor de Jobs
inyectados vía ``app.dependency_overrides`` (mismo patrón que ``test_api.py``).
"""

from __future__ import annotations

import time
from contextlib import contextmanager
from pathlib import Path
from typing import Dict, Iterator, List, Optional, Tuple

from fastapi.testclient import TestClient

import main
from app import config
from app.api import process as process_api
from app.deps import checker as _deps_checker
from app.jobs.manager import JobManager
from app.jobs.runner import JobRunner
from app.models.job import JobStatus, PipelineStep
from app.models.settings import Ajustes, GrupoSubtitulo
from app.storage import config_store
from app.storage.workdir import JobWorkdir


def _verificacion_ok(*_a, **_k) -> _deps_checker.ResultadoVerificacion:
    return _deps_checker.ResultadoVerificacion(
        resultados=[
            _deps_checker.ResultadoDependencia(nombre=n, disponible=True)
            for n in _deps_checker.DEPENDENCIAS
        ]
    )


def _fakes() -> Dict[str, object]:
    def fn_unir(job, orden, ancho, alto, fps, **kw):  # noqa: ANN001
        return job.resolve("unido.mp4")

    def fn_cortar(entrada, salida, **kw):  # noqa: ANN001
        return Path(salida)

    def fn_transcribir(entrada, at, audio, **kw):  # noqa: ANN001
        return []

    def fn_subtitulos(entrada, palabras, sub, res, ass, salida, **kw):  # noqa: ANN001
        return Path(salida)

    def fn_musica(entrada, mwav, mus, salida, **kw):  # noqa: ANN001
        return Path(salida)

    def fn_preservar(job, tmp):  # noqa: ANN001
        return job.output_path

    return dict(
        fn_unir=fn_unir,
        fn_cortar=fn_cortar,
        fn_transcribir=fn_transcribir,
        fn_subtitulos=fn_subtitulos,
        fn_musica=fn_musica,
        fn_preservar=fn_preservar,
    )


@contextmanager
def _cliente(
    manager: JobManager, runner: Optional[JobRunner] = None
) -> Iterator[TestClient]:
    ejecutor = runner if runner is not None else JobRunner(manager, **_fakes())
    main.verificar_dependencias = _verificacion_ok  # type: ignore[assignment]
    main.app.dependency_overrides[process_api.obtener_gestor_jobs] = lambda: manager
    main.app.dependency_overrides[process_api.obtener_job_runner] = lambda: ejecutor
    try:
        yield TestClient(main.app)
    finally:
        main.app.dependency_overrides.pop(process_api.obtener_gestor_jobs, None)
        main.app.dependency_overrides.pop(process_api.obtener_job_runner, None)


# ---------------------------------------------------------------------------
# /subtitulos/{id}
# ---------------------------------------------------------------------------
def _job_en_revision(manager: JobManager, job_id: str) -> None:
    manager.crear_job(job_id, ["a"], Ajustes(), workdir="wd")
    grupos = [
        GrupoSubtitulo(texto="hola mundo", inicio_s=0.0, fin_s=1.0),
        GrupoSubtitulo(texto="segundo grupo", inicio_s=1.0, fin_s=2.0),
    ]
    manager.marcar_esperando_revision(job_id, "/tmp/cortado.mp4", grupos)


def test_get_subtitulos_devuelve_grupos_editables() -> None:
    manager = JobManager()
    _job_en_revision(manager, "job-rev")
    with _cliente(manager) as client:
        resp = client.get("/subtitulos/job-rev")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["estado"] == "esperando_revision"
        assert body["editable"] is True
        assert [g["texto"] for g in body["grupos"]] == ["hola mundo", "segundo grupo"]


def test_get_subtitulos_job_inexistente_404() -> None:
    with _cliente(JobManager()) as client:
        resp = client.get("/subtitulos/no-existe")
        assert resp.status_code == 404
        assert resp.json()["error"]["code"] == "JOB_NOT_FOUND"


def test_post_subtitulos_conflicto_si_no_esta_en_revision() -> None:
    manager = JobManager()
    manager.crear_job("job-x", ["a"], Ajustes(), workdir="wd")  # estado en_cola
    with _cliente(manager) as client:
        resp = client.post("/subtitulos/job-x", json={"grupos": [{"texto": "x"}]})
        assert resp.status_code == 409
        assert resp.json()["error"]["code"] == "CONFLICT"


def test_post_subtitulos_rechaza_conteo_distinto() -> None:
    manager = JobManager()
    _job_en_revision(manager, "job-rev2")
    with _cliente(manager) as client:
        # Solo 1 grupo cuando había 2 propuestos.
        resp = client.post("/subtitulos/job-rev2", json={"grupos": [{"texto": "uno"}]})
        assert resp.status_code == 400
        assert resp.json()["error"]["code"] == "INVALID_REQUEST"


def _esperar_estado(manager: JobManager, job_id: str, objetivos, timeout: float = 5.0):
    """Espera (con polling) hasta que el Job alcance uno de los estados objetivo."""
    fin = time.monotonic() + timeout
    while time.monotonic() < fin:
        estado = manager.obtener(job_id).progreso.estado
        if estado in objetivos:
            return estado
        time.sleep(0.05)
    return manager.obtener(job_id).progreso.estado


def test_post_subtitulos_reanuda_a_eleccion_render(tmp_path: Path, monkeypatch) -> None:
    """Tras enviar los subtítulos editados, el Job se pausa para elegir motor y,
    al elegir uno vía ``POST /render/{id}``, se renderiza hasta completar.

    Refleja el nuevo flujo (spec subtitulos-ia-remotion, tarea 8.2): la revisión
    manual ya NO renderiza directamente, sino que prepara los grupos finales y
    pausa en ``ESPERANDO_ELECCION_RENDER``; el render efectivo lo dispara el
    endpoint de elección de motor (tarea 8.1).
    """
    monkeypatch.setattr(config, "WORKDIR_ROOT", tmp_path / "wk")
    monkeypatch.setattr(config, "OUTPUT_ROOT", tmp_path / "out")
    manager = JobManager()
    _job_en_revision(manager, "job-rev3")
    with _cliente(manager) as client:
        resp = client.post(
            "/subtitulos/job-rev3",
            json={"grupos": [{"texto": "Hola Mundo"}, {"texto": "Segundo Grupo"}]},
        )
        assert resp.status_code == 202, resp.text
        assert resp.json()["estado"] == "en_ejecucion"

        # La preparación corre en background: el Job debe pausarse esperando la
        # elección del motor (no completar directamente).
        estado = _esperar_estado(
            manager,
            "job-rev3",
            (JobStatus.ESPERANDO_ELECCION_RENDER, JobStatus.FALLIDO),
        )
        assert estado == JobStatus.ESPERANDO_ELECCION_RENDER

        # GET /render devuelve los grupos finales corregidos (solo lectura).
        resp = client.get("/render/job-rev3")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["estado"] == "esperando_eleccion_render"
        assert body["editable"] is True
        assert [g["texto"] for g in body["grupos"]] == ["Hola Mundo", "Segundo Grupo"]

        # POST /render con el motor elegido reanuda el render en background.
        resp = client.post("/render/job-rev3", json={"motor": "ass"})
        assert resp.status_code == 202, resp.text
        assert resp.json()["estado"] == "en_ejecucion"

    # El render corre en background: esperar a que alcance un estado terminal.
    estado = _esperar_estado(
        manager, "job-rev3", (JobStatus.COMPLETADO, JobStatus.FALLIDO)
    )
    assert estado == JobStatus.COMPLETADO


# ---------------------------------------------------------------------------
# /configuracion
# ---------------------------------------------------------------------------
def test_configuracion_get_vacia_put_y_delete(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(config, "USER_CONFIG_ROOT", tmp_path / "cfg")
    manager = JobManager()
    with _cliente(manager) as client:
        # GET inicial: sin ajustes guardados.
        resp = client.get("/configuracion")
        assert resp.status_code == 200
        assert resp.json()["ajustes"] is None

        # PUT: guardar ajustes válidos con transición y revisión.
        ajustes = Ajustes()
        ajustes.transiciones.tipo = "disolucion"
        ajustes.transiciones.duracion_ms = 350
        ajustes.subtitulos.revisar = True
        resp = client.put("/configuracion", json={"ajustes": ajustes.model_dump()})
        assert resp.status_code == 200, resp.text
        assert resp.json()["guardado"] is True

        # GET tras guardar: devuelve lo persistido.
        resp = client.get("/configuracion")
        body = resp.json()["ajustes"]
        assert body is not None
        assert body["transiciones"]["tipo"] == "disolucion"
        assert body["transiciones"]["duracion_ms"] == 350
        assert body["subtitulos"]["revisar"] is True

        # DELETE: restablecer.
        resp = client.delete("/configuracion")
        assert resp.status_code == 200
        assert resp.json()["borrado"] is True
        assert client.get("/configuracion").json()["ajustes"] is None


def test_configuracion_put_rechaza_invalido(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(config, "USER_CONFIG_ROOT", tmp_path / "cfg")
    manager = JobManager()
    with _cliente(manager) as client:
        ajustes = Ajustes().model_dump()
        ajustes["generales"]["fps"] = 0  # fuera de rango (1..120)
        resp = client.put("/configuracion", json={"ajustes": ajustes})
        assert resp.status_code == 400
        assert resp.json()["error"]["code"] == "INVALID_REQUEST"
        assert "generales.fps" in resp.json()["error"]["details"]["campos_invalidos"]
        # No se guardó nada.
        assert config_store.cargar_ajustes() is None
