"""Endpoint de descarga ``GET /descargar/{id}`` (Req 11.2, 11.3, 11.4).

Sirve el ``Video_Final`` MP4 de un Job **completado** como descarga adjunta.

Contrato (según el diseño):

* **200 OK:** stream del MP4 con ``Content-Type: video/mp4`` y
  ``Content-Disposition: attachment`` para un Job completado (Req 11.2).
* **409 RESULT_NOT_READY:** el Job existe pero no finalizó correctamente (no está
  en estado ``completado``); no se devuelve ningún archivo (Req 11.3,
  Propiedad 24).
* **404 JOB_NOT_FOUND:** no existe ningún Job con ese identificador (Req 11.4).

El Gestor de Jobs se obtiene mediante la dependencia compartida
:func:`app.api.process.obtener_gestor_jobs` (sustituible en pruebas).

Referencias de requisitos: 11.2, 11.3, 11.4.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse, JSONResponse

from app import config
from app.api.process import obtener_gestor_jobs
from app.jobs.manager import JobManager
from app.models.errors import error_envelope
from app.models.job import JobStatus

router = APIRouter(tags=["descargar"])


def _no_encontrado(job_id: str) -> JSONResponse:
    """Respuesta ``404 JOB_NOT_FOUND`` homogénea (Req 11.4)."""
    return JSONResponse(
        status_code=404,
        content=error_envelope(
            "JOB_NOT_FOUND",
            "No existe ningún Job con el identificador indicado.",
            {"job_id": job_id},
        ),
    )


def _no_listo(job_id: str, estado: str) -> JSONResponse:
    """Respuesta ``409 RESULT_NOT_READY`` homogénea (Req 11.3)."""
    return JSONResponse(
        status_code=409,
        content=error_envelope(
            "RESULT_NOT_READY",
            "El Video_Final no está disponible: el Job no finalizó correctamente.",
            {"job_id": job_id, "estado": estado},
        ),
    )


@router.get("/descargar/{job_id}")
async def descargar(
    job_id: str,
    manager: JobManager = Depends(obtener_gestor_jobs),
):
    """Descarga el ``Video_Final`` MP4 de un Job completado (Req 11.2-11.4).

    Rechaza con ``404`` si el Job no existe (Req 11.4) y con ``409`` si el Job no
    está completado (Req 11.3, Propiedad 24).
    """
    job = manager.obtener(job_id)
    if job is None:
        return _no_encontrado(job_id)

    # Solo un Job completado tiene Video_Final disponible (Req 11.3, Propiedad 24).
    if job.progreso.estado != JobStatus.COMPLETADO:
        return _no_listo(job_id, job.progreso.estado.value)

    # Ruta del Video_Final: la registrada por el pipeline o, en su defecto, la
    # ruta de salida canónica del Job.
    ruta: Optional[str] = job.ruta_video_final
    ruta_final = Path(ruta) if ruta else config.job_output_path(job_id)

    if not ruta_final.exists():
        # Completado pero el archivo no está disponible en disco: se trata como
        # resultado no disponible (Req 11.3).
        return _no_listo(job_id, job.progreso.estado.value)

    return FileResponse(
        path=str(ruta_final),
        media_type="video/mp4",
        filename=f"{job_id}.mp4",
    )
