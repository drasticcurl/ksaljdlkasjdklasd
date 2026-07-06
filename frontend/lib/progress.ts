/**
 * Suscripción al progreso de un Job.
 *
 * Estrategia (Req 10.6): por defecto se usa **SSE** (`EventSource` sobre
 * `GET /progreso/{id}?stream=true`) y, si SSE no está disponible o falla, se cae
 * automáticamente a **polling** (`GET /progreso/{id}` cada N ms). En ambos casos
 * se garantiza una actualización al menos cada 5 s.
 *
 * `suscribirProgreso` devuelve una función de cancelación que cierra el stream
 * SSE o detiene el temporizador de polling.
 *
 * Requisitos: 10.6.
 */

import { obtenerProgreso, buildUrl, API_BASE_URL } from './api';
import type { JobProgress, JobStatus } from './types';

/** Estados terminales del Job: al alcanzarlos, la suscripción se detiene. */
const ESTADOS_TERMINALES: ReadonlySet<JobStatus> = new Set<JobStatus>([
  'completado',
  'fallido',
]);

/** Intervalo de polling por defecto (ms). <= 5 s para cumplir Req 10.6. */
export const POLLING_INTERVALO_MS = 3_000;

export interface SuscribirProgresoOpciones {
  /** URL base del backend (por defecto {@link API_BASE_URL}). */
  baseUrl?: string;
  /** Intervalo de polling en ms cuando se usa el fallback. */
  pollingIntervaloMs?: number;
  /** Fuerza el uso de polling y omite SSE (útil para pruebas o entornos sin SSE). */
  forzarPolling?: boolean;
  /** Se invoca con cada actualización de progreso. */
  onProgress: (progreso: JobProgress) => void;
  /** Se invoca ante un error irrecuperable (p. ej. Job inexistente). */
  onError?: (error: unknown) => void;
  /** Se invoca una vez cuando el Job alcanza un estado terminal. */
  onDone?: (progreso: JobProgress) => void;
}

/** Función que cancela una suscripción activa. */
export type CancelarSuscripcion = () => void;

/** Indica si `EventSource` está disponible en el entorno actual. */
function soportaSSE(): boolean {
  return typeof EventSource !== 'undefined';
}

/**
 * Se suscribe al progreso de un Job usando SSE con fallback a polling.
 *
 * @returns función para cancelar la suscripción (idempotente).
 */
export function suscribirProgreso(
  jobId: string,
  opciones: SuscribirProgresoOpciones,
): CancelarSuscripcion {
  const {
    baseUrl = API_BASE_URL,
    pollingIntervaloMs = POLLING_INTERVALO_MS,
    forzarPolling = false,
    onProgress,
    onError,
    onDone,
  } = opciones;

  let cancelado = false;
  let fuente: EventSource | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let abort: AbortController | null = null;

  const finalizar = () => {
    if (fuente) {
      fuente.close();
      fuente = null;
    }
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (abort) {
      abort.abort();
      abort = null;
    }
  };

  const cancelar: CancelarSuscripcion = () => {
    cancelado = true;
    finalizar();
  };

  const manejarProgreso = (progreso: JobProgress) => {
    if (cancelado) return;
    onProgress(progreso);
    if (ESTADOS_TERMINALES.has(progreso.estado)) {
      finalizar();
      onDone?.(progreso);
    }
  };

  // --- Fallback: polling ---
  const iniciarPolling = () => {
    if (cancelado || timer) return;

    const sondear = async () => {
      if (cancelado) return;
      abort = new AbortController();
      try {
        const progreso = await obtenerProgreso(jobId, {
          baseUrl,
          signal: abort.signal,
        });
        manejarProgreso(progreso);
      } catch (err) {
        if (!cancelado) {
          finalizar();
          onError?.(err);
        }
      }
    };

    // Sondeo inmediato + periódico (Req 10.6: al menos cada 5 s).
    void sondear();
    timer = setInterval(() => void sondear(), pollingIntervaloMs);
  };

  // --- Preferido: SSE ---
  const iniciarSSE = () => {
    const url = buildUrl(
      `/progreso/${encodeURIComponent(jobId)}?stream=true`,
      baseUrl,
    );
    try {
      fuente = new EventSource(url);
    } catch {
      iniciarPolling();
      return;
    }

    const onMensaje = (evento: MessageEvent) => {
      if (cancelado) return;
      try {
        const progreso = JSON.parse(evento.data) as JobProgress;
        manejarProgreso(progreso);
      } catch {
        // Ignora eventos malformados/heartbeats sin datos JSON.
      }
    };

    // El backend emite eventos nombrados `progreso`; también escuchamos el
    // evento por defecto `message` por robustez.
    fuente.addEventListener('progreso', onMensaje as EventListener);
    fuente.onmessage = onMensaje;

    fuente.onerror = () => {
      if (cancelado) return;
      // SSE falló (o el navegador no puede mantener la conexión): cerrar y caer
      // a polling para seguir cumpliendo Req 10.6.
      if (fuente) {
        fuente.close();
        fuente = null;
      }
      iniciarPolling();
    };
  };

  if (forzarPolling || !soportaSSE()) {
    iniciarPolling();
  } else {
    iniciarSSE();
  }

  return cancelar;
}
