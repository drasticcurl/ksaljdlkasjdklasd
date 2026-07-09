"""Gestor de Jobs en memoria (Tarea 12.2, Req 10.3, 10.5).

Mantiene el registro de Jobs (``job_id -> JobState``) protegido por un lock, con:

* **Transiciones de estado** en el ciclo de vida del Job:
  ``EN_COLA -> EN_EJECUCION -> COMPLETADO | FALLIDO`` (Req 10.3).
* **Progreso como fuente de verdad** consultada por ``GET /progreso`` (Req 10.5),
  con porcentaje en ``0..100`` **monótono no decreciente** y el índice de paso
  también monótono no decreciente: cualquier actualización que intentara
  retroceder el porcentaje o el índice se **ignora** para ese campo (se conserva
  el valor máximo alcanzado). Esto garantiza la Propiedad 22 (invariantes de
  progreso).

Concurrencia: el registro se protege con un :class:`threading.RLock`, correcto
tanto para la capa API asíncrona como para el ejecutor en background (que corre
el pipeline en un hilo del executor). Todas las operaciones que leen o mutan el
estado adquieren el lock.

Referencias de requisitos: 10.3, 10.5.
"""

from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.models.job import JobState, JobStatus, PipelineStep, Progress
from app.models.settings import Ajustes

# Conjunto de estados terminales del ciclo de vida de un Job.
ESTADOS_TERMINALES = frozenset({JobStatus.COMPLETADO, JobStatus.FALLIDO})


def _ahora() -> datetime:
    return datetime.now(timezone.utc)


class JobManager:
    """Registro de Jobs en memoria con transiciones y progreso monótono.

    El Gestor es la única fuente de verdad del estado y el progreso de cada Job.
    """

    def __init__(self) -> None:
        self._jobs: Dict[str, JobState] = {}
        self._lock = threading.RLock()

    # ------------------------------------------------------------------
    # Registro
    # ------------------------------------------------------------------
    def crear_job(
        self,
        job_id: str,
        orden_clips: List[str],
        ajustes: Ajustes,
        workdir: str,
        *,
        musica_id: Optional[str] = None,
    ) -> JobState:
        """Registra un nuevo Job en estado ``EN_COLA`` (Req 10.3).

        Raises:
            ValueError: Si ya existe un Job con ese ``job_id``.
        """
        with self._lock:
            if job_id in self._jobs:
                raise ValueError(f"Ya existe un Job con id {job_id!r}")
            estado = JobState(
                id=job_id,
                orden_clips=list(orden_clips),
                musica_id=musica_id,
                ajustes=ajustes,
                workdir=workdir,
                progreso=Progress(estado=JobStatus.EN_COLA),
            )
            self._jobs[job_id] = estado
            return estado

    def existe(self, job_id: str) -> bool:
        """Indica si hay un Job registrado con ``job_id``."""
        with self._lock:
            return job_id in self._jobs

    def obtener(self, job_id: str) -> Optional[JobState]:
        """Devuelve el :class:`JobState` de ``job_id`` o ``None`` si no existe."""
        with self._lock:
            return self._jobs.get(job_id)

    def listar_ids(self) -> List[str]:
        """Devuelve la lista de identificadores de Jobs registrados."""
        with self._lock:
            return list(self._jobs.keys())

    # ------------------------------------------------------------------
    # Transiciones de estado
    # ------------------------------------------------------------------
    def marcar_en_ejecucion(self, job_id: str) -> JobState:
        """Transición ``EN_COLA -> EN_EJECUCION`` (Req 10.3)."""
        with self._lock:
            job = self._exigir(job_id)
            job.progreso.estado = JobStatus.EN_EJECUCION
            job.actualizado_en = _ahora()
            return job

    def marcar_esperando_revision(
        self,
        job_id: str,
        cortado_path: str,
        grupos: object,
    ) -> JobState:
        """Pausa el Job en ``ESPERANDO_REVISION`` para la revisión manual de subtítulos.

        Almacena la ruta del video ``cortado`` (sobre el que se quemarán los
        subtítulos al reanudar) y los ``grupos`` de subtítulo propuestos para
        editar. El porcentaje/índice de paso alcanzados se conservan (la fase 2
        del pipeline los continuará), respetando la monotonicidad (Req 10.5).
        """
        with self._lock:
            job = self._exigir(job_id)
            job.cortado_path = cortado_path
            job.grupos_subtitulos = list(grupos) if grupos is not None else []
            job.progreso.estado = JobStatus.ESPERANDO_REVISION
            job.progreso.mensaje = "Esperando revisión de subtítulos"
            job.actualizado_en = _ahora()
            return job

    def marcar_completado(
        self, job_id: str, ruta_video_final: Optional[str] = None
    ) -> JobState:
        """Transición a ``COMPLETADO`` fijando el 100 % (Req 10.3, 10.5)."""
        with self._lock:
            job = self._exigir(job_id)
            job.progreso.estado = JobStatus.COMPLETADO
            job.progreso.porcentaje = 100
            job.progreso.indice_paso = job.progreso.total_pasos
            job.progreso.error = None
            if ruta_video_final is not None:
                job.ruta_video_final = ruta_video_final
            job.actualizado_en = _ahora()
            return job

    def marcar_fallido(
        self, job_id: str, paso: object, motivo: str
    ) -> JobState:
        """Transición a ``FALLIDO`` exponiendo ``error = {paso, motivo}`` (Req 10.7)."""
        with self._lock:
            job = self._exigir(job_id)
            job.progreso.estado = JobStatus.FALLIDO
            paso_val = paso.value if isinstance(paso, PipelineStep) else str(paso)
            job.progreso.error = {"paso": paso_val, "motivo": motivo}
            job.actualizado_en = _ahora()
            return job

    # ------------------------------------------------------------------
    # Progreso (fuente de verdad, monótono no decreciente)
    # ------------------------------------------------------------------
    def actualizar_progreso(
        self,
        job_id: str,
        *,
        estado: JobStatus,
        indice_paso: int,
        paso_actual: Optional[PipelineStep],
        porcentaje: int,
        mensaje: str,
        error: Optional[Dict[str, Any]] = None,
    ) -> JobState:
        """Aplica una actualización de progreso preservando la monotonicidad.

        El porcentaje y el índice de paso **nunca retroceden**: se conserva el
        máximo alcanzado (Req 10.5, Propiedad 22). El porcentaje se acota además
        a ``[0, 100]`` de forma defensiva. El estado, el paso actual, el mensaje y
        el error sí se actualizan al último valor reportado.

        Raises:
            KeyError: Si ``job_id`` no existe.
        """
        with self._lock:
            job = self._exigir(job_id)
            prog = job.progreso

            # Acotar a [0, 100] y aplicar monotonicidad no decreciente (Req 10.5).
            pct_acotado = max(0, min(100, int(porcentaje)))
            prog.porcentaje = max(prog.porcentaje, pct_acotado)
            prog.indice_paso = max(prog.indice_paso, int(indice_paso))

            prog.estado = estado
            prog.paso_actual = paso_actual
            prog.mensaje = mensaje
            if error is not None:
                prog.error = error
            elif estado != JobStatus.FALLIDO:
                # Un avance normal no borra un error previo salvo que no lo haya;
                # en la práctica los avances normales no traen error.
                pass

            job.actualizado_en = _ahora()
            return job

    # ------------------------------------------------------------------
    # Utilidades internas
    # ------------------------------------------------------------------
    def _exigir(self, job_id: str) -> JobState:
        job = self._jobs.get(job_id)
        if job is None:
            raise KeyError(f"Job inexistente: {job_id!r}")
        return job


# Instancia compartida por defecto para la aplicación (la capa API la reutiliza).
gestor_jobs = JobManager()


__all__ = ["JobManager", "gestor_jobs", "ESTADOS_TERMINALES"]
