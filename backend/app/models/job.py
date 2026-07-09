"""Modelos de estado y progreso de un Job.

Define el ciclo de vida del Job, los pasos del pipeline y la estructura de
progreso que es la fuente de verdad consultada por `GET /progreso/{id}`.

Referencias de requisitos: 10.3, 10.5, 10.7, 13.3.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from app.models.settings import Ajustes


class JobStatus(str, Enum):
    """Estados posibles de un Job (Req 10.3)."""

    EN_COLA = "en_cola"
    EN_EJECUCION = "en_ejecucion"
    # El pipeline se pausó tras agrupar las palabras y espera la revisión/edición
    # de los subtítulos por parte del usuario antes de renderizar (Fase B).
    ESPERANDO_REVISION = "esperando_revision"
    COMPLETADO = "completado"
    FALLIDO = "fallido"


class PipelineStep(str, Enum):
    """Pasos del pipeline de procesamiento, en orden estricto."""

    UNIR = "UNIR"
    CORTAR_SILENCIOS = "CORTAR_SILENCIOS"
    TRANSCRIBIR = "TRANSCRIBIR"
    SUBTITULOS = "SUBTITULOS"
    MUSICA = "MUSICA"


# Número total de pasos del pipeline.
TOTAL_PASOS: int = 5


class Progress(BaseModel):
    """Estado de progreso de un Job (Req 10.3, 10.5, 10.7).

    El campo ``error`` contiene ``{"paso": ..., "motivo": ...}`` cuando el Job
    está en estado ``FALLIDO`` (Req 10.7).
    """

    estado: JobStatus = Field(default=JobStatus.EN_COLA)
    paso_actual: Optional[PipelineStep] = Field(default=None)
    indice_paso: int = Field(default=0, ge=0, le=TOTAL_PASOS)
    total_pasos: int = Field(default=TOTAL_PASOS)
    porcentaje: int = Field(default=0, ge=0, le=100)
    mensaje: str = Field(default="")
    error: Optional[Dict[str, Any]] = Field(
        default=None, description='{"paso": ..., "motivo": ...} cuando FALLIDO'
    )


def _ahora() -> datetime:
    return datetime.now(timezone.utc)


class JobState(BaseModel):
    """Estado completo de un Job en el registro en memoria del Gestor de Jobs.

    Referencias de requisitos: 10.1, 10.2 (cardinalidad de ``orden_clips``),
    13.3 (``workdir`` por Job).
    """

    id: str = Field(..., description="Identificador único del Job")
    orden_clips: List[str] = Field(
        ..., description="Orden de clips 1..500 recibido (Req 10.1, 10.2)"
    )
    musica_id: Optional[str] = Field(default=None)
    ajustes: Ajustes
    workdir: str = Field(..., description="Directorio de trabajo del Job (Req 13.3)")
    ruta_video_final: Optional[str] = Field(default=None)
    # Grupos de subtítulo serializados ({texto, inicio_s, fin_s}) calculados en
    # la Fase A; se exponen al usuario para su revisión/edición y se usan (ya
    # editados) al reanudar en la Fase B.
    grupos: Optional[list] = Field(default=None)
    # Ruta del video tras cortar silencios (Fase A). Se conserva mientras el Job
    # está en ESPERANDO_REVISION para poder reanudar el render (Fase B).
    ruta_cortado: Optional[str] = Field(default=None)
    progreso: Progress = Field(default_factory=Progress)
    creado_en: datetime = Field(default_factory=_ahora)
    actualizado_en: datetime = Field(default_factory=_ahora)
