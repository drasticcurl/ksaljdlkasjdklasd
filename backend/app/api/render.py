"""Endpoints de elección del motor de render (``GET``/``POST`` ``/render/{id}``).

Tras preparar los grupos finales de subtítulos (agrupación + corrección IA
opcional), el pipeline se pausa en el estado ``ESPERANDO_ELECCION_RENDER`` (ver
:mod:`app.engine.pipeline` y :meth:`app.jobs.runner.JobRunner.reanudar_job`). En
ese momento la Interfaz muestra al usuario los subtítulos ya corregidos y **dos
botones** —"Editar con Remotion" y "ffmpeg"— para que **él** elija el motor de
render. Estos endpoints dan soporte a esa pausa (spec subtitulos-ia-remotion,
Req 6.2, 6.3, 7.1-7.3, 8.1, 8.2):

* ``GET /render/{job_id}``: obtener los ``grupos_finales`` (solo lectura) y el
  estado del Job, para que el frontend muestre los subtítulos corregidos junto a
  los dos botones (y resalte el ``motor_preferido`` como mera sugerencia visual).
* ``POST /render/{job_id}``: enviar el motor elegido (``{"motor": "ass" |
  "remotion"}``) y **reanudar** el pipeline ejecutando EXACTAMENTE ese motor, sin
  fallback (Req 7.1-7.4). Responde ``202`` y el render corre en background.

Contratos de error (Req 8.1, 8.2):

* ``404 JOB_NOT_FOUND`` si el Job no existe.
* ``400 INVALID_REQUEST`` si ``motor`` no es ``"ass"`` ni ``"remotion"``.
* ``409 CONFLICT`` si el Job no está en ``ESPERANDO_ELECCION_RENDER`` (no hay
  ninguna elección de motor pendiente para ese Job).
"""

from __future__ import annotations

from typing import get_args

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.api.process import obtener_gestor_jobs, obtener_job_runner
from app.jobs.manager import JobManager
from app.jobs.runner import JobRunner
from app.models.errors import error_envelope
from app.models.job import JobStatus
from app.models.settings import MotorRender

router = APIRouter(tags=["render"])

# Conjunto de motores de render válidos, derivado del tipo ``MotorRender``
# (``{"ass", "remotion"}``) para no duplicar la fuente de verdad.
_MOTORES_VALIDOS = frozenset(get_args(MotorRender))


class ElegirRenderRequest(BaseModel):
    """Cuerpo de ``POST /render/{id}``: el motor de render elegido por el usuario."""

    motor: str = Field(default="")


def _no_encontrado(job_id: str) -> JSONResponse:
    return JSONResponse(
        status_code=404,
        content=error_envelope(
            "JOB_NOT_FOUND",
            "No existe ningún Job con el identificador indicado.",
            {"job_id": job_id},
        ),
    )


def _conflicto(job_id: str, estado: str) -> JSONResponse:
    return JSONResponse(
        status_code=409,
        content=error_envelope(
            "CONFLICT",
            "El Job no está esperando la elección del motor de render.",
            {"job_id": job_id, "estado": estado},
        ),
    )


@router.get("/render/{job_id}")
async def obtener_render(
    job_id: str,
    manager: JobManager = Depends(obtener_gestor_jobs),
) -> JSONResponse:
    """Devuelve los grupos finales corregidos y el estado del Job (Req 6.2).

    Responde ``404`` si el Job no existe. Si el Job existe pero no está en
    ``ESPERANDO_ELECCION_RENDER`` se devuelven los grupos disponibles
    (posiblemente vacíos) junto con el estado y ``editable=false``. Incluye
    ``motor_preferido`` (preselección de UI: solo resalta un botón; no fuerza la
    ejecución).
    """
    if not manager.existe(job_id):
        return _no_encontrado(job_id)
    job = manager.obtener(job_id)
    grupos = job.grupos_finales or []
    return JSONResponse(
        status_code=200,
        content={
            "job_id": job_id,
            "estado": job.progreso.estado.value,
            "editable": job.progreso.estado == JobStatus.ESPERANDO_ELECCION_RENDER,
            "motor_preferido": job.ajustes.render.motor_preferido,
            "grupos": [g.model_dump() for g in grupos],
        },
    )


@router.post("/render/{job_id}")
async def elegir_render(
    job_id: str,
    peticion: ElegirRenderRequest,
    manager: JobManager = Depends(obtener_gestor_jobs),
    runner: JobRunner = Depends(obtener_job_runner),
) -> JSONResponse:
    """Aplica el motor elegido y reanuda el render en background (Req 7.1-7.3, 8.1, 8.2).

    Validaciones (en orden): ``404`` si el Job no existe; ``400 INVALID_REQUEST``
    si ``motor`` no es ``"ass"`` ni ``"remotion"``; ``409 CONFLICT`` si el Job no
    está en ``ESPERANDO_ELECCION_RENDER``. En caso válido lanza la reanudación del
    render (que ejecuta EXACTAMENTE el motor elegido, sin fallback) y responde
    ``202`` con el Job en ejecución.
    """
    if not manager.existe(job_id):
        return _no_encontrado(job_id)

    if peticion.motor not in _MOTORES_VALIDOS:
        return JSONResponse(
            status_code=400,
            content=error_envelope(
                "INVALID_REQUEST",
                "El motor de render debe ser 'ass' o 'remotion'.",
                {"motor": peticion.motor, "validos": sorted(_MOTORES_VALIDOS)},
            ),
        )

    job = manager.obtener(job_id)
    if job.progreso.estado != JobStatus.ESPERANDO_ELECCION_RENDER:
        return _conflicto(job_id, job.progreso.estado.value)

    # Reanuda el render en background con EXACTAMENTE el motor elegido (sin
    # fallback): responde 202 mientras el render corre en segundo plano.
    await runner.lanzar_reanudacion_render(job_id, peticion.motor)

    return JSONResponse(
        status_code=202,
        content={"job_id": job_id, "estado": JobStatus.EN_EJECUCION.value},
    )
