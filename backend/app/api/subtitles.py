"""Endpoints de revisión de subtítulos ``GET/POST /subtitulos/{id}``.

Habilitan el flujo de **revisión previa al render**: cuando un Job se pausa en
estado ``ESPERANDO_REVISION`` (tras agrupar las palabras, Fase A), la Interfaz
obtiene las líneas de subtítulo para que el usuario las revise/edite y, al
confirmar, se reanuda el render (Fase B).

Contrato:

* ``GET /subtitulos/{id}``:
    - **200 OK:** ``{"grupos": [{"indice": i, "texto": ..., "inicio_s": ...,
      "fin_s": ...}, ...]}`` cuando el Job existe y está en
      ``ESPERANDO_REVISION``.
    - **404 JOB_NOT_FOUND:** el Job no existe.
    - **409 NOT_IN_REVIEW:** el Job existe pero no está en revisión.

* ``POST /subtitulos/{id}`` con cuerpo ``{"grupos": [{"texto", "inicio_s",
  "fin_s"}, ...]}``:
    - **202 Accepted:** ``{"job_id": id, "estado": "en_ejecucion"}``; guarda los
      grupos editados y lanza la Fase B en background.
    - **404 JOB_NOT_FOUND:** el Job no existe.
    - **409 NOT_IN_REVIEW:** el Job no está en revisión.
    - **400 INVALID_REQUEST:** el cuerpo no incluye ``grupos`` válidos.

Reutiliza el Gestor de Jobs y el ejecutor compartidos vía las dependencias de
``app.api.process`` (sustituibles en pruebas).
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.api.process import obtener_gestor_jobs, obtener_job_runner
from app.jobs.manager import JobManager
from app.jobs.runner import JobRunner
from app.models.errors import error_envelope
from app.models.job import JobStatus

router = APIRouter(tags=["subtitulos"])


class GrupoEditado(BaseModel):
    """Una línea de subtítulo editable enviada por la Interfaz."""

    texto: str = Field(default="")
    inicio_s: float = Field(default=0.0)
    fin_s: float = Field(default=0.0)


class ConfirmarSubtitulosRequest(BaseModel):
    """Cuerpo de ``POST /subtitulos/{id}``: los grupos editados por el usuario."""

    grupos: Optional[List[GrupoEditado]] = Field(default=None)


def _no_encontrado(job_id: str) -> JSONResponse:
    """Respuesta ``404 JOB_NOT_FOUND`` homogénea."""
    return JSONResponse(
        status_code=404,
        content=error_envelope(
            "JOB_NOT_FOUND",
            "No existe ningún Job con el identificador indicado.",
            {"job_id": job_id},
        ),
    )


def _no_en_revision(job_id: str, estado: str) -> JSONResponse:
    """Respuesta ``409 NOT_IN_REVIEW`` homogénea."""
    return JSONResponse(
        status_code=409,
        content=error_envelope(
            "NOT_IN_REVIEW",
            "El Job no está esperando revisión de subtítulos.",
            {"job_id": job_id, "estado": estado},
        ),
    )


@router.get("/subtitulos/{job_id}")
async def obtener_subtitulos(
    job_id: str,
    manager: JobManager = Depends(obtener_gestor_jobs),
) -> JSONResponse:
    """Devuelve las líneas de subtítulo a revisar de un Job en revisión.

    Responde ``404`` si el Job no existe y ``409 NOT_IN_REVIEW`` si el Job no
    está en ``ESPERANDO_REVISION``.
    """
    job = manager.obtener(job_id)
    if job is None:
        return _no_encontrado(job_id)
    if job.progreso.estado != JobStatus.ESPERANDO_REVISION:
        return _no_en_revision(job_id, job.progreso.estado.value)

    grupos = job.grupos or []
    salida = [
        {
            "indice": i,
            "texto": g.get("texto", ""),
            "inicio_s": g.get("inicio_s", 0.0),
            "fin_s": g.get("fin_s", 0.0),
        }
        for i, g in enumerate(grupos)
    ]
    return JSONResponse(status_code=200, content={"grupos": salida})


@router.post("/subtitulos/{job_id}")
async def confirmar_subtitulos(
    job_id: str,
    peticion: ConfirmarSubtitulosRequest,
    manager: JobManager = Depends(obtener_gestor_jobs),
    runner: JobRunner = Depends(obtener_job_runner),
) -> JSONResponse:
    """Guarda los subtítulos editados y reanuda el render (Fase B) en background.

    Responde ``202`` con ``{"job_id": id, "estado": "en_ejecucion"}`` cuando el
    Job está en revisión. Rechaza con ``404`` (inexistente), ``409``
    (no está en revisión) o ``400`` (cuerpo sin ``grupos``).
    """
    job = manager.obtener(job_id)
    if job is None:
        return _no_encontrado(job_id)
    if job.progreso.estado != JobStatus.ESPERANDO_REVISION:
        return _no_en_revision(job_id, job.progreso.estado.value)

    if peticion.grupos is None:
        return JSONResponse(
            status_code=400,
            content=error_envelope(
                "INVALID_REQUEST",
                "La petición debe incluir 'grupos'.",
                {"campo": "grupos"},
            ),
        )

    grupos_editados = [
        {"texto": g.texto, "inicio_s": g.inicio_s, "fin_s": g.fin_s}
        for g in peticion.grupos
    ]

    # Reanuda la Fase B en background (no bloquea la respuesta).
    await runner.reanudar(job_id, grupos_editados)

    return JSONResponse(
        status_code=202,
        content={"job_id": job_id, "estado": "en_ejecucion"},
    )
