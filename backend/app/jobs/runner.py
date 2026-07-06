"""Ejecución del pipeline en background y limpieza del workdir (Tarea 12.3).

El :class:`JobRunner` ejecuta el pipeline completo de un Job **sin bloquear** la
respuesta de ``POST /procesar``: la corrutina :meth:`JobRunner.lanzar` delega el
trabajo intensivo (ffmpeg, whisper) a un hilo del executor mediante
``loop.run_in_executor``, de modo que el bucle de eventos siga libre (Req 10.1).

Al finalizar el Job —tanto en éxito como en error/cancelación— se invoca la
**limpieza del directorio de trabajo** (``JobWorkdir.cleanup``) para no dejar
temporales en disco (Req 13.4, 13.5). El ``Video_Final`` se conserva fuera del
workdir (lo hace el pipeline con ``preservar_video_final``), por lo que sobrevive
a la limpieza.

El progreso se canaliza hacia el :class:`~app.jobs.manager.JobManager`, que es la
fuente de verdad y garantiza la monotonicidad del porcentaje (Req 10.5).

Referencias de requisitos: 10.1, 13.4, 13.5.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable, Optional

from app.engine.pipeline import (
    EventoProgreso,
    ReporteProgreso,
    ResultadoPipeline,
    ejecutar_pipeline,
)
from app.engine.proc import Runner, ejecutar_comando
from app.jobs.manager import JobManager
from app.storage.workdir import JobWorkdir

logger = logging.getLogger(__name__)

# Resolutor opcional de la ruta del WAV de música a partir del ``musica_id``.
# Por defecto no resuelve música (se implementará junto al endpoint POST /musica).
ResolverMusica = Callable[[Optional[str]], Optional[str]]

# Resolutor de la ruta de archivo de un clip a partir de su ``clip_id``. El
# ``Orden_de_Clips`` de un Job contiene identificadores de clip, pero el pipeline
# (paso UNIR → ``ffprobe``) necesita **rutas** reales. Por defecto es la identidad
# (devuelve el id tal cual) para no romper los tests que usan ids ficticios sin
# archivos en disco; en producción se inyecta un resolutor que hace glob sobre el
# almacén de clips.
ResolverClip = Callable[[str], str]


def _sin_musica(_musica_id: Optional[str]) -> Optional[str]:
    return None


def _identidad_clip(clip_id: str) -> str:
    return clip_id


class JobRunner:
    """Ejecuta el pipeline de un Job en background y limpia sus temporales."""

    def __init__(
        self,
        manager: JobManager,
        *,
        runner: Runner = ejecutar_comando,
        resolver_musica: ResolverMusica = _sin_musica,
        resolver_clip: ResolverClip = _identidad_clip,
        **inyecciones_pipeline: Any,
    ) -> None:
        """Crea el ejecutor.

        Args:
            manager: Gestor de Jobs (fuente de verdad del estado/progreso).
            runner: Ejecutor de comandos externos inyectable.
            resolver_musica: Función que traduce ``musica_id`` a ruta de WAV.
            resolver_clip: Función que traduce cada ``clip_id`` del
                ``Orden_de_Clips`` a la **ruta** de archivo del clip almacenado.
                Por defecto es la identidad (devuelve el id) para no romper los
                tests que usan ids ficticios; en producción se inyecta un
                resolutor que hace glob sobre el almacén de clips.
            **inyecciones_pipeline: Pasos inyectables reenviados a
                :func:`ejecutar_pipeline` (``fn_unir``, ``fn_cortar``, ...),
                útiles en pruebas.
        """
        self.manager = manager
        self.runner = runner
        self.resolver_musica = resolver_musica
        self.resolver_clip = resolver_clip
        self._inyecciones = inyecciones_pipeline

    def _crear_reporter(self, job_id: str) -> ReporteProgreso:
        """Crea un reporter que canaliza los eventos del pipeline al Gestor."""

        def reportar(evento: EventoProgreso) -> None:
            self.manager.actualizar_progreso(
                job_id,
                estado=evento.estado,
                indice_paso=evento.indice_paso,
                paso_actual=evento.paso_actual,
                porcentaje=evento.porcentaje,
                mensaje=evento.mensaje,
                error=evento.error,
            )

        return reportar

    def ejecutar_job(self, job_id: str) -> ResultadoPipeline:
        """Ejecuta el pipeline de un Job de forma **síncrona** (para el executor).

        Marca el Job en ejecución, ejecuta los cinco pasos, registra el resultado
        en el Gestor y —pase lo que pase— limpia el directorio de trabajo
        (Req 13.4, 13.5).

        Returns:
            El :class:`ResultadoPipeline` del Job.

        Raises:
            KeyError: Si el Job no existe en el Gestor.
        """
        job_state = self.manager.obtener(job_id)
        if job_state is None:
            raise KeyError(f"Job inexistente: {job_id!r}")

        self.manager.marcar_en_ejecucion(job_id)
        job_wd = JobWorkdir(job_id)
        reporter = self._crear_reporter(job_id)
        musica_wav = self.resolver_musica(job_state.musica_id)

        # El ``Orden_de_Clips`` almacenado contiene identificadores de clip; el
        # pipeline (paso UNIR → ``ffprobe``) necesita RUTAS de archivo reales, así
        # que se resuelve cada id a su ruta antes de ejecutar (BUG: se pasaban ids
        # y ``ffprobe`` fallaba con "No such file or directory"). Con el resolutor
        # por defecto (identidad) el comportamiento no cambia para los tests.
        orden_rutas = [self.resolver_clip(cid) for cid in job_state.orden_clips]

        resultado: ResultadoPipeline
        try:
            resultado = ejecutar_pipeline(
                job_wd,
                orden_rutas,
                job_state.ajustes,
                musica_wav=musica_wav,
                reporter=reporter,
                runner=self.runner,
                **self._inyecciones,
            )
            if resultado.exito:
                self.manager.marcar_completado(
                    job_id,
                    ruta_video_final=(
                        str(resultado.ruta_video_final)
                        if resultado.ruta_video_final is not None
                        else None
                    ),
                )
            else:
                # El pipeline ya reportó el evento FALLIDO; se refuerza el estado.
                self.manager.marcar_fallido(
                    job_id,
                    resultado.paso_fallido,
                    resultado.motivo or "fallo del pipeline",
                )
        except Exception as exc:  # noqa: BLE001 - fallo inesperado => Job fallido
            logger.exception("Fallo inesperado ejecutando el Job %s", job_id)
            self.manager.marcar_fallido(job_id, "PIPELINE", str(exc))
            resultado = ResultadoPipeline(exito=False, motivo=str(exc))
        finally:
            # Limpieza de temporales en toda terminación (Req 13.4, 13.5).
            try:
                job_wd.cleanup()
            except Exception:  # noqa: BLE001 - la limpieza no debe propagar
                logger.exception(
                    "Fallo al limpiar el workdir del Job %s", job_id
                )

        return resultado

    async def lanzar(self, job_id: str) -> asyncio.Future:
        """Lanza la ejecución del Job en background sin bloquear (Req 10.1).

        Programa :meth:`ejecutar_job` en el executor por defecto del bucle de
        eventos y devuelve inmediatamente el :class:`asyncio.Future` asociado, de
        modo que ``POST /procesar`` pueda responder el ``job_id`` en <= 2 s.

        Returns:
            El ``Future`` de la ejecución en background (no se espera aquí).
        """
        loop = asyncio.get_event_loop()
        return loop.run_in_executor(None, self.ejecutar_job, job_id)


__all__ = ["JobRunner", "ResolverMusica", "ResolverClip"]
