'use client';

/**
 * EleccionRender — Elección manual del motor de render de subtítulos.
 *
 * Se muestra cuando un Job está en estado `esperando_eleccion_render`: obtiene
 * los subtítulos ya corregidos (`GET /render/{id}`) y los presenta en SOLO
 * LECTURA, junto con dos botones —"Editar con Remotion" y "ffmpeg"— para que el
 * usuario elija el motor. Al pulsar, llama a `POST /render/{id}` con el motor
 * elegido para reanudar el pipeline; se ejecuta exactamente ese motor (sin
 * fallback automático).
 *
 * `motor_preferido` (que llega en la respuesta) se usa ÚNICAMENTE para resaltar
 * visualmente el botón sugerido; no fuerza la elección.
 *
 * Requisitos: 6.2, 6.3.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiError, elegirRender, obtenerRender } from '@/lib/api';
import type { GrupoSubtitulo, MotorRender } from '@/lib/types';

export interface EleccionRenderProps {
  /** Id del Job pausado esperando la elección de motor. */
  jobId: string;
  baseUrl?: string;
  /** Se invoca cuando el motor se elige correctamente (reanudación). */
  onElegido?: (motor: MotorRender) => void;
  /** Inyección opcional (tests). */
  obtenerFn?: typeof obtenerRender;
  elegirFn?: typeof elegirRender;
}

/** Formatea segundos como `m:ss.d` para mostrar el rango de cada línea. */
function fmtTiempo(s: number): string {
  const min = Math.floor(s / 60);
  const seg = (s % 60).toFixed(1).padStart(4, '0');
  return `${min}:${seg}`;
}

export default function EleccionRender({
  jobId,
  baseUrl,
  onElegido,
  obtenerFn = obtenerRender,
  elegirFn = elegirRender,
}: EleccionRenderProps) {
  const [grupos, setGrupos] = useState<GrupoSubtitulo[] | null>(null);
  const [motorPreferido, setMotorPreferido] = useState<MotorRender>('ass');
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setCargando(true);
    setError(null);
    obtenerFn(jobId, { baseUrl })
      .then((res) => {
        if (cancelado) return;
        setGrupos(res.grupos);
        setMotorPreferido(res.motor_preferido);
      })
      .catch((err) => {
        if (cancelado) return;
        setError(
          err instanceof ApiError
            ? err.message
            : 'No se pudieron cargar los subtítulos para elegir el motor.',
        );
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [jobId, baseUrl, obtenerFn]);

  const elegir = useCallback(
    async (motor: MotorRender) => {
      if (enviando || grupos === null) return;
      setEnviando(true);
      setError(null);
      try {
        await elegirFn(jobId, motor, { baseUrl });
        onElegido?.(motor);
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.message
            : 'No se pudo iniciar el render con el motor elegido.',
        );
        setEnviando(false);
      }
    },
    [enviando, grupos, jobId, baseUrl, elegirFn, onElegido],
  );

  // Clases del botón: se resalta el `motor_preferido` (solo sugerencia visual).
  const claseBoton = (motor: MotorRender): string => {
    const base =
      'rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50';
    return motor === motorPreferido
      ? `${base} bg-blue-600 ring-2 ring-blue-400`
      : `${base} bg-gray-700`;
  };

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-editor-border bg-editor-panel p-4"
      data-testid="eleccion-render"
    >
      <div>
        <h3 className="text-lg font-medium text-white">Elegir motor de render</h3>
        <p className="mt-1 text-sm text-gray-400">
          Estos son los subtítulos ya corregidos. Elige con qué motor quieres
          generar el video: Remotion (subtítulos animados de mayor calidad) o
          ffmpeg (quemado clásico). Se ejecutará exactamente el motor que elijas.
        </p>
      </div>

      {cargando && (
        <p data-testid="eleccion-cargando" className="text-sm text-gray-300">
          Cargando subtítulos…
        </p>
      )}

      {error && (
        <p
          role="alert"
          data-testid="eleccion-error"
          className="text-sm text-red-400"
        >
          {error}
        </p>
      )}

      {grupos && grupos.length > 0 && (
        <ul
          className="flex flex-col gap-2"
          data-testid="eleccion-subtitulos"
        >
          {grupos.map((g, i) => (
            <li key={i} className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">
                {fmtTiempo(g.inicio_s)} – {fmtTiempo(g.fin_s)}
              </span>
              {/* Solo lectura: en esta fase el texto ya está corregido. */}
              <p
                data-testid={`eleccion-linea-${i}`}
                className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-white"
              >
                {g.texto}
              </p>
            </li>
          ))}
        </ul>
      )}

      {grupos && grupos.length === 0 && !cargando && (
        <p className="text-sm text-gray-400">
          No se detectaron subtítulos.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => elegir('remotion')}
          disabled={enviando || cargando || grupos === null}
          data-testid="eleccion-motor-remotion"
          className={claseBoton('remotion')}
        >
          Editar con Remotion
        </button>
        <button
          type="button"
          onClick={() => elegir('ass')}
          disabled={enviando || cargando || grupos === null}
          data-testid="eleccion-motor-ass"
          className={claseBoton('ass')}
        >
          ffmpeg
        </button>
      </div>

      {enviando && (
        <p data-testid="eleccion-enviando" className="text-sm text-gray-300">
          Iniciando el render…
        </p>
      )}
    </div>
  );
}
