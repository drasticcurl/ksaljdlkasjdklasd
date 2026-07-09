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
    finalizar_render,
    procesar_hasta_agrupar,
)
from app.engine.proc import Runner, ejecutar_comando
from app.jobs.manager import JobManager
from app.models.job import JobStatus
from app.models.settings import GrupoSubtitulo
from app.storage.workdir import JobWorkdir

logger = logging.getLogger(__name__)


def grupos_a_dicts(grupos) -> list:
    """Serializa grupos de subtítulo a dicts ``{texto, inicio_s, fin_s}``.

    Acepta tanto :class:`~app.models.settings.GrupoSubtitulo` como dicts ya
    serializados (idempotente).
    """
    salida = []
    for g in grupos:
        if isinstance(g, GrupoSubtitulo):
            salida.append(
                {"texto": g.texto, "inicio_s": g.inicio_s, "fin_s": g.fin_s}
            )
        else:
            salida.append(
                {
                    "texto": g["texto"],
                    "inicio_s": g["inicio_s"],
                    "fin_s": g["fin_s"],
                }
            )
    return salida


def dicts_a_grupos(grupos) -> list:
    """Convierte dicts ``{texto, inicio_s, fin_s}`` en :class:`GrupoSubtitulo`."""
    salida = []
    for g in grupos:
        if isinstance(g, GrupoSubtitulo):
            salida.append(g)
        else:
            salida.append(
                GrupoSubtitulo(
                    texto=g["texto"],
                    inicio_s=float(g["inicio_s"]),
                    fin_s=float(g["fin_s"]),
                )
            )
    return salida

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
        """Ejecuta el Job de forma **síncrona** (para el executor).

        Corre la **Fase A** (UNIR → CORTAR_SILENCIOS → TRANSCRIBIR → agrupar). A
        continuación:

        * Si ``ajustes.subtitulos.revisar_antes_de_renderizar`` es ``True``: marca
          el Job en ``ESPERANDO_REVISION`` guardando ``grupos`` y ``ruta_cortado``
          y **no limpia el workdir** (debe persistir para la Fase B al reanudar).
        * Si es ``False``: corre la **Fase B**, marca ``COMPLETADO`` (o
          ``FALLIDO``) y limpia el workdir (comportamiento histórico).

        Si la Fase A falla, marca ``FALLIDO`` y limpia.

        Returns:
            El :class:`ResultadoPipeline` del Job (para el flujo sin revisión) o
            un resultado con ``exito=True`` cuando el Job queda a la espera de
            revisión.

        Raises:
            KeyError: Si el Job no existe en el Gestor.
        """
        job_state = self.manager.obtener(job_id)
        if job_state is None:
            raise KeyError(f"Job inexistente: {job_id!r}")

        self.manager.marcar_en_ejecucion(job_id)
        job_wd = JobWorkdir(job_id)
        reporter = self._crear_reporter(job_id)

        # El ``Orden_de_Clips`` almacenado contiene identificadores de clip; el
        # pipeline (paso UNIR → ``ffprobe``) necesita RUTAS de archivo reales, así
        # que se resuelve cada id a su ruta antes de ejecutar. Con el resolutor
        # por defecto (identidad) el comportamiento no cambia para los tests.
        orden_rutas = [self.resolver_clip(cid) for cid in job_state.orden_clips]

        try:
            resultado_a = procesar_hasta_agrupar(
                job_wd,
                orden_rutas,
                job_state.ajustes,
                reporter=reporter,
                runner=self.runner,
                **self._inyecciones,
            )
        except Exception as exc:  # noqa: BLE001 - fallo inesperado => Job fallido
            logger.exception("Fallo inesperado en la Fase A del Job %s", job_id)
            self.manager.marcar_fallido(job_id, "PIPELINE", str(exc))
            self._limpiar(job_wd, job_id)
            return ResultadoPipeline(exito=False, motivo=str(exc))

        if not resultado_a.exito:
            # La Fase A ya reportó el evento FALLIDO; se refuerza el estado.
            self.manager.marcar_fallido(
                job_id,
                resultado_a.paso_fallido,
                resultado_a.motivo or "fallo del pipeline",
            )
            self._limpiar(job_wd, job_id)
            return ResultadoPipeline(
                exito=False,
                paso_fallido=resultado_a.paso_fallido,
                motivo=resultado_a.motivo,
            )

        # Flujo CON revisión: pausar y esperar edición del usuario (NO limpiar).
        if job_state.ajustes.subtitulos.revisar_antes_de_renderizar:
            self.manager.marcar_esperando_revision(
                job_id,
                grupos=grupos_a_dicts(resultado_a.grupos),
                ruta_cortado=str(resultado_a.ruta_cortado),
            )
            logger.info(
                "Job %s en ESPERANDO_REVISION: %d grupos a revisar",
                job_id,
                len(resultado_a.grupos),
            )
            return ResultadoPipeline(exito=True)

        # Flujo SIN revisión: renderizar directamente (Fase B) y limpiar.
        return self._finalizar(
            job_id, job_wd, job_state, resultado_a.grupos, resultado_a.ruta_cortado
        )

    def reanudar_job(self, job_id: str, grupos_editados) -> ResultadoPipeline:
        """Reanuda un Job en ``ESPERANDO_REVISION`` corriendo la Fase B.

        Valida que el Job esté en revisión, guarda los ``grupos`` editados y
        ejecuta la Fase B (quemar subtítulos → música → preservar), marcando
        ``COMPLETADO`` o ``FALLIDO`` y limpiando el workdir al terminar.

        Raises:
            KeyError: Si el Job no existe.
            ValueError: Si el Job no está en ``ESPERANDO_REVISION``.
        """
        job_state = self.manager.obtener(job_id)
        if job_state is None:
            raise KeyError(f"Job inexistente: {job_id!r}")
        if job_state.progreso.estado != JobStatus.ESPERANDO_REVISION:
            raise ValueError(
                f"El Job {job_id!r} no está en revisión (estado="
                f"{job_state.progreso.estado.value})"
            )

        # Guardar los grupos editados y reanudar.
        self.manager.actualizar_grupos(job_id, grupos_a_dicts(grupos_editados))
        self.manager.marcar_en_ejecucion(job_id)

        job_wd = JobWorkdir(job_id)
        grupos = dicts_a_grupos(grupos_editados)
        ruta_cortado = job_state.ruta_cortado or ""
        return self._finalizar(job_id, job_wd, job_state, grupos, ruta_cortado)

    def _finalizar(
        self, job_id, job_wd, job_state, grupos, ruta_cortado
    ) -> ResultadoPipeline:
        """Ejecuta la Fase B, actualiza el estado y limpia el workdir."""
        reporter = self._crear_reporter(job_id)
        musica_wav = self.resolver_musica(job_state.musica_id)
        resultado: ResultadoPipeline
        try:
            resultado = finalizar_render(
                job_wd,
                job_state.ajustes,
                grupos,
                str(ruta_cortado),
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
                self.manager.marcar_fallido(
                    job_id,
                    resultado.paso_fallido,
                    resultado.motivo or "fallo del pipeline",
                )
        except Exception as exc:  # noqa: BLE001 - fallo inesperado => Job fallido
            logger.exception("Fallo inesperado en la Fase B del Job %s", job_id)
            self.manager.marcar_fallido(job_id, "PIPELINE", str(exc))
            resultado = ResultadoPipeline(exito=False, motivo=str(exc))
        finally:
            self._limpiar(job_wd, job_id)
        return resultado

    def _limpiar(self, job_wd: JobWorkdir, job_id: str) -> None:
        """Limpia el workdir del Job tolerando errores (Req 13.4, 13.5)."""
        try:
            job_wd.cleanup()
        except Exception:  # noqa: BLE001 - la limpieza no debe propagar
            logger.exception("Fallo al limpiar el workdir del Job %s", job_id)

    async def lanzar(self, job_id: str) -> asyncio.Future:
        """Lanza la ejecución del Job en background sin bloquear (Req 10.1).

        Programa :meth:`ejecutar_job` en el executor por defecto del bucle de
        eventos y devuelve inmediatamente el :class:`asyncio.Future` asociado, de
        modo que ``POST /procesar`` pueda responder el ``job_id`` en <= 2 s.
        """
        loop = asyncio.get_event_loop()
        return loop.run_in_executor(None, self.ejecutar_job, job_id)

    async def reanudar(self, job_id: str, grupos_editados) -> asyncio.Future:
        """Lanza la Fase B (reanudación) en background sin bloquear.

        Programa :meth:`reanudar_job` en el executor para que ``POST
        /subtitulos/{id}`` pueda responder ``202`` rápidamente.
        """
        loop = asyncio.get_event_loop()
        return loop.run_in_executor(
            None, self.reanudar_job, job_id, grupos_editados
        )


__all__ = [
    "JobRunner",
    "ResolverMusica",
    "ResolverClip",
    "grupos_a_dicts",
    "dicts_a_grupos",
]
