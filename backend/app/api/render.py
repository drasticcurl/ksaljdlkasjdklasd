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

from pathlib import Path
from typing import Any, Callable, Dict, Optional, get_args

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app import config
from app.api.process import obtener_gestor_jobs, obtener_job_runner
from app.engine.ffprobe import ClipInfo, inspeccionar_clip
from app.jobs.manager import JobManager
from app.jobs.runner import JobRunner
from app.models.errors import error_envelope
from app.models.job import JobState, JobStatus
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


def _inspeccionar_duracion_best_effort(
    cortado_path: str,
    inspeccionar_fn: Callable[..., ClipInfo],
) -> Optional[float]:
    """Obtiene ``duracion_s`` inspeccionando el vídeo cortado (best-effort, Req 1.5).

    Inspecciona ``cortado_path`` con ``inspeccionar_fn`` (por defecto
    :func:`app.engine.ffprobe.inspeccionar_clip`, inyectable para los tests) y
    devuelve la duración en segundos. Cualquier excepción durante la inspección
    (``ffprobe`` ausente, clip no decodificable, salida ilegible, etc.) se
    captura y resulta en ``None`` sin propagar, de modo que la respuesta de
    ``GET /render`` nunca falla por no poder inspeccionar el vídeo (Req 1.5).

    También devuelve ``None`` cuando la inspección tiene éxito pero el clip no
    expone una duración (``ClipInfo.duracion_s is None``).
    """
    try:
        info = inspeccionar_fn(cortado_path)
    except Exception:  # noqa: BLE001 - best-effort: cualquier fallo => None (Req 1.5)
        return None
    return info.duracion_s


def construir_respuesta_render(
    job: JobState,
    inspeccionar_fn: Callable[..., ClipInfo] = inspeccionar_clip,
) -> Dict[str, Any]:
    """Construye el cuerpo (solo lectura) de ``GET /render/{id}`` (Req 1.1-1.7).

    Además de los campos históricos (``job_id``, ``estado``, ``editable``,
    ``motor_preferido``, ``grupos``), expone los datos necesarios para la
    previsualización del vídeo real con subtítulos (spec
    previsualizacion-video-real-remotion, Req 1):

    * ``video_nombre`` / ``video_url``: nombre y URL HTTP del vídeo de fondo ya
      cortado, servido por ``GET /workfile/{job_id}/{nombre}``. Se derivan de
      ``job.cortado_path`` reutilizando el mismo patrón de construcción de URL
      que :func:`app.engine.pipeline.renderizar_con_motor_elegido`
      (``http://{BACKEND_HOST}:{BACKEND_PORT}/workfile/...``). Si
      ``cortado_path`` es ``None`` ambos son ``None`` (Req 1.2, 1.3).
    * ``fps`` / ``ancho`` / ``alto``: tomados de ``job.ajustes.generales`` (Req 1.4).
    * ``duracion_s``: duración del vídeo cortado, inspeccionada best-effort con
      ``inspeccionar_fn`` (inyectable). Cualquier fallo de inspección resulta en
      ``None`` sin propagar (Req 1.5). Si ``cortado_path`` es ``None`` también es
      ``None`` (no hay vídeo que inspeccionar).
    * ``grupos``: cada grupo incluye ``palabras`` (Req 1.6), garantizado por
      :meth:`GrupoSubtitulo.model_dump` y reforzado con una aserción de contrato.

    Args:
        job: Job del que se construye la respuesta.
        inspeccionar_fn: Inspector de clips inyectable (por defecto
            :func:`app.engine.ffprobe.inspeccionar_clip`); facilita los tests.

    No muta el ``job`` (operación de solo lectura, Req 1.7).
    """
    grupos = [g.model_dump() for g in (job.grupos_finales or [])]
    # Aserción de contrato (Req 1.6): ``GrupoSubtitulo.model_dump()`` siempre
    # serializa el campo ``palabras`` (``None`` si el grupo no tiene palabras).
    assert all("palabras" in grupo for grupo in grupos), (
        "Cada grupo de la respuesta de /render debe incluir el campo 'palabras'"
    )

    generales = job.ajustes.generales

    if job.cortado_path is not None:
        video_nombre = Path(job.cortado_path).name
        video_url = (
            f"http://{config.BACKEND_HOST}:{config.BACKEND_PORT}"
            f"/workfile/{job.id}/{video_nombre}"
        )
        duracion_s = _inspeccionar_duracion_best_effort(
            job.cortado_path, inspeccionar_fn
        )
    else:
        video_nombre = None
        video_url = None
        duracion_s = None

    return {
        "job_id": job.id,
        "estado": job.progreso.estado.value,
        "editable": job.progreso.estado == JobStatus.ESPERANDO_ELECCION_RENDER,
        "motor_preferido": job.ajustes.render.motor_preferido,
        "grupos": grupos,
        # --- Datos del vídeo real para la previsualización (Req 1.1-1.5) ---
        "video_url": video_url,
        "video_nombre": video_nombre,
        "fps": generales.fps,
        "ancho": generales.resolucion.ancho,
        "alto": generales.resolucion.alto,
        # Duración inspeccionada best-effort (Req 1.5): None si falla o no hay vídeo.
        "duracion_s": duracion_s,
    }


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

    Además de los grupos y la preselección de motor, la respuesta incluye los
    datos del vídeo real de fondo (``video_url``/``video_nombre``), sus
    dimensiones (``fps``/``ancho``/``alto``) y la duración (``duracion_s``) para
    que el frontend pueda montar la previsualización con subtítulos (spec
    previsualizacion-video-real-remotion, Req 1). Ver
    :func:`construir_respuesta_render`.
    """
    if not manager.existe(job_id):
        return _no_encontrado(job_id)
    job = manager.obtener(job_id)
    return JSONResponse(
        status_code=200,
        content=construir_respuesta_render(job),
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
