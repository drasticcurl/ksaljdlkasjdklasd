'use client';

/**
 * ProgressPanel — Indicador de progreso del Job (Tarea 20.2).
 *
 * Se suscribe al progreso del Job con `progress.suscribirProgreso` (SSE con
 * fallback a polling), que garantiza una actualización al menos cada 5 s
 * (Req 10.6). Muestra:
 *   - El paso actual del pipeline y su índice (p. ej. "Paso 3 de 5: TRANSCRIBIR").
 *   - El porcentaje de avance (0..100) con una barra de progreso (Req 10.6).
 *   - El estado terminal: al completar, notifica `onCompletado`; al fallar,
 *     refleja el estado fallido con el paso y el motivo del error (Req 10.7).
 *
 * La suscripción se abre al montar (o al cambiar `jobId`) y se cancela al
 * desmontar para no dejar streams/temporizadores activos.
 *
 * Requisitos: 10.6, 10.7.
 */

import { useEffect, useState } from 'react';
import { suscribirProgreso } from '@/lib/progress';
import type { JobProgress, PipelineStep } from '@/lib/types';

export interface ProgressPanelProps {
  /** Id del Job a seguir. */
  jobId: string;
  /** URL base del backend (se propaga a la suscripción). */
  baseUrl?: string;
  /** Se invoca una vez cuando el Job alcanza el estado `completado`. */
  onCompletado?: (progreso: JobProgress) => void;
  /**
   * Inyección opcional de la función de suscripción (por defecto
   * `progress.suscribirProgreso`). Útil para pruebas.
   */
  suscribir?: typeof suscribirProgreso;
}

/** Etiquetas legibles de cada paso del pipeline. */
const ETIQUETA_PASO: Record<PipelineStep, string> = {
  UNIR: 'Unir clips',
  CORTAR_SILENCIOS: 'Cortar silencios',
  TRANSCRIBIR: 'Transcribir audio',
  SUBTITULOS: 'Generar subtítulos',
  MUSICA: 'Mezclar música',
};

export default function ProgressPanel({
  jobId,
  baseUrl,
  onCompletado,
  suscribir = suscribirProgreso,
}: ProgressPanelProps) {
  const [progreso, setProgreso] = useState<JobProgress | null>(null);
  const [errorSuscripcion, setErrorSuscripcion] = useState<string | null>(null);

  useEffect(() => {
    setProgreso(null);
    setErrorSuscripcion(null);

    const cancelar = suscribir(jobId, {
      baseUrl,
      onProgress: (p) => setProgreso(p),
      onError: () =>
        setErrorSuscripcion(
          'Se perdió la conexión con el seguimiento de progreso.',
        ),
      onDone: (p) => {
        setProgreso(p);
        if (p.estado === 'completado') {
          onCompletado?.(p);
        }
      },
    });

    return cancelar;
    // `suscribir`/`onCompletado`/`baseUrl` se mantienen estables por el llamador.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const porcentaje = progreso
    ? Math.max(0, Math.min(100, Math.round(progreso.porcentaje)))
    : 0;

  const nombrePaso = progreso?.paso_actual
    ? ETIQUETA_PASO[progreso.paso_actual]
    : null;

  const fallido = progreso?.estado === 'fallido';

  return (
    <div className="flex flex-col gap-2" data-testid="progress-panel">
      <div className="flex items-center justify-between text-sm text-gray-200">
        <span data-testid="progress-estado">
          {progreso ? estadoLegible(progreso.estado) : 'Conectando…'}
        </span>
        <span data-testid="progress-porcentaje">{porcentaje}%</span>
      </div>

      {/* Paso actual del pipeline (Req 10.6). */}
      {progreso && progreso.paso_actual && (
        <p data-testid="progress-paso" className="text-sm text-gray-300">
          Paso {progreso.indice_paso} de {progreso.total_pasos}
          {nombrePaso ? `: ${nombrePaso}` : ''}
        </p>
      )}

      {/* Barra de progreso (0..100). */}
      <div
        className="h-2 w-full overflow-hidden rounded bg-gray-700"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={porcentaje}
      >
        <div
          data-testid="progress-barra"
          className={`h-full ${fallido ? 'bg-red-500' : 'bg-blue-500'}`}
          style={{ width: `${porcentaje}%` }}
        />
      </div>

      {progreso?.mensaje && !fallido && (
        <p data-testid="progress-mensaje" className="text-xs text-gray-400">
          {progreso.mensaje}
        </p>
      )}

      {/* Estado fallido con paso y motivo (Req 10.7). */}
      {fallido && (
        <p role="alert" data-testid="progress-error" className="text-sm text-red-400">
          {progreso?.error
            ? `El procesamiento falló en el paso "${progreso.error.paso}": ${progreso.error.motivo}`
            : 'El procesamiento falló.'}
        </p>
      )}

      {errorSuscripcion && !fallido && (
        <p
          role="alert"
          data-testid="progress-error-conexion"
          className="text-sm text-yellow-400"
        >
          {errorSuscripcion}
        </p>
      )}
    </div>
  );
}

/** Traduce el estado del Job a una etiqueta legible. */
function estadoLegible(estado: JobProgress['estado']): string {
  switch (estado) {
    case 'en_cola':
      return 'En cola';
    case 'en_ejecucion':
      return 'Procesando';
    case 'completado':
      return 'Completado';
    case 'fallido':
      return 'Fallido';
    default:
      return estado;
  }
}
