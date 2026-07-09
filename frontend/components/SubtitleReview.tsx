'use client';

/**
 * SubtitleReview — Revisión y edición de subtítulos antes de renderizar.
 *
 * Cuando un Job está en estado `esperando_revision`, este componente:
 *   1. Obtiene las líneas de subtítulo con `api.obtenerSubtitulos`.
 *   2. Muestra una lista EDITABLE: un textarea por línea con su rango de tiempo
 *      `inicio_s–fin_s` visible (solo el texto es editable; los tiempos se
 *      conservan).
 *   3. Ofrece un botón "Confirmar y generar video" que envía los textos editados
 *      con `api.confirmarSubtitulos`, lo que reanuda el render (Fase B).
 *
 * Refleja el estado de carga, envío y errores.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiError, confirmarSubtitulos, obtenerSubtitulos } from '@/lib/api';
import type { GrupoSubtitulo } from '@/lib/types';

export interface SubtitleReviewProps {
  /** Id del Job en revisión. */
  jobId: string;
  /** URL base del backend (se propaga a las llamadas). */
  baseUrl?: string;
  /** Se invoca tras confirmar con éxito (para seguir mostrando el progreso). */
  onConfirmado?: () => void;
  /** Inyección opcional del cliente de obtención (útil para pruebas). */
  obtenerFn?: typeof obtenerSubtitulos;
  /** Inyección opcional del cliente de confirmación (útil para pruebas). */
  confirmarFn?: typeof confirmarSubtitulos;
}

/** Formatea segundos como `m:ss.d` legible para el rango de tiempo. */
function formatoTiempo(segundos: number): string {
  if (!Number.isFinite(segundos)) return '—';
  const min = Math.floor(segundos / 60);
  const seg = segundos - min * 60;
  return `${min}:${seg.toFixed(1).padStart(4, '0')}`;
}

export default function SubtitleReview({
  jobId,
  baseUrl,
  onConfirmado,
  obtenerFn = obtenerSubtitulos,
  confirmarFn = confirmarSubtitulos,
}: SubtitleReviewProps) {
  const [grupos, setGrupos] = useState<GrupoSubtitulo[] | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const [confirmado, setConfirmado] = useState(false);

  useEffect(() => {
    let cancelado = false;
    setCargando(true);
    setErrorCarga(null);
    obtenerFn(jobId, { baseUrl })
      .then((resp) => {
        if (!cancelado) setGrupos(resp.grupos);
      })
      .catch((err: unknown) => {
        if (!cancelado) {
          const msg =
            err instanceof ApiError
              ? err.message
              : 'No se pudieron obtener los subtítulos.';
          setErrorCarga(msg);
        }
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [jobId, baseUrl, obtenerFn]);

  const editarTexto = useCallback((indice: number, texto: string) => {
    setGrupos((prev) =>
      prev
        ? prev.map((g, i) => (i === indice ? { ...g, texto } : g))
        : prev,
    );
  }, []);

  const manejarConfirmar = useCallback(async () => {
    if (!grupos) return;
    setEnviando(true);
    setErrorEnvio(null);
    try {
      await confirmarFn(jobId, grupos, { baseUrl });
      setConfirmado(true);
      onConfirmado?.();
    } catch (err: unknown) {
      const msg =
        err instanceof ApiError
          ? err.message
          : 'No se pudo confirmar. Inténtalo de nuevo.';
      setErrorEnvio(msg);
    } finally {
      setEnviando(false);
    }
  }, [grupos, jobId, baseUrl, confirmarFn, onConfirmado]);

  return (
    <div className="flex flex-col gap-3" data-testid="subtitle-review">
      <h3 className="text-sm font-semibold text-white">
        Revisa los subtítulos antes de generar el video
      </h3>

      {cargando && (
        <p data-testid="review-cargando" className="text-sm text-gray-400">
          Cargando subtítulos…
        </p>
      )}

      {errorCarga && (
        <p
          role="alert"
          data-testid="review-error-carga"
          className="text-sm text-red-400"
        >
          {errorCarga}
        </p>
      )}

      {grupos && grupos.length === 0 && !cargando && (
        <p data-testid="review-vacio" className="text-sm text-gray-400">
          No hay subtítulos que revisar.
        </p>
      )}

      {grupos && grupos.length > 0 && (
        <ul className="flex flex-col gap-2" data-testid="review-lista">
          {grupos.map((g, i) => (
            <li
              key={g.indice ?? i}
              className="flex flex-col gap-1 rounded border border-gray-700 p-2"
              data-testid={`review-linea-${i}`}
            >
              <span
                className="text-xs text-gray-500"
                data-testid={`review-tiempo-${i}`}
              >
                {formatoTiempo(g.inicio_s)} – {formatoTiempo(g.fin_s)}
              </span>
              <textarea
                data-testid={`review-texto-${i}`}
                value={g.texto}
                rows={2}
                disabled={enviando || confirmado}
                onChange={(e) => editarTexto(i, e.target.value)}
                className="w-full rounded border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-white"
              />
            </li>
          ))}
        </ul>
      )}

      {errorEnvio && (
        <p
          role="alert"
          data-testid="review-error-envio"
          className="text-sm text-red-400"
        >
          {errorEnvio}
        </p>
      )}

      <button
        type="button"
        data-testid="review-confirmar"
        disabled={cargando || enviando || confirmado || !grupos}
        onClick={manejarConfirmar}
        className="self-start rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {enviando
          ? 'Generando…'
          : confirmado
            ? 'Confirmado'
            : 'Confirmar y generar video'}
      </button>
    </div>
  );
}
