'use client';

/**
 * SubtitleReview — Revisión y edición manual del texto de los subtítulos.
 *
 * Se muestra cuando un Job está en estado `esperando_revision`: obtiene los
 * grupos propuestos (`GET /subtitulos/{id}`), permite editar el **texto** de
 * cada línea (los tiempos se conservan en el backend) y, al aceptar, envía el
 * texto editado (`POST /subtitulos/{id}`) para reanudar el pipeline (quemar
 * subtítulos + música).
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiError, enviarSubtitulos, obtenerSubtitulos } from '@/lib/api';
import type { GrupoSubtitulo } from '@/lib/types';

export interface SubtitleReviewProps {
  /** Id del Job pausado para revisión. */
  jobId: string;
  baseUrl?: string;
  /** Se invoca cuando el texto editado se envía correctamente (reanudación). */
  onEnviado?: () => void;
  /** Inyección opcional (tests). */
  obtenerFn?: typeof obtenerSubtitulos;
  enviarFn?: typeof enviarSubtitulos;
}

/** Formatea segundos como `m:ss.d` para mostrar el rango de cada línea. */
function fmtTiempo(s: number): string {
  const min = Math.floor(s / 60);
  const seg = (s % 60).toFixed(1).padStart(4, '0');
  return `${min}:${seg}`;
}

export default function SubtitleReview({
  jobId,
  baseUrl,
  onEnviado,
  obtenerFn = obtenerSubtitulos,
  enviarFn = enviarSubtitulos,
}: SubtitleReviewProps) {
  const [grupos, setGrupos] = useState<GrupoSubtitulo[] | null>(null);
  const [textos, setTextos] = useState<string[]>([]);
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
        setTextos(res.grupos.map((g) => g.texto));
      })
      .catch((err) => {
        if (cancelado) return;
        setError(
          err instanceof ApiError
            ? err.message
            : 'No se pudieron cargar los subtítulos para revisar.',
        );
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [jobId, baseUrl, obtenerFn]);

  const aceptar = useCallback(async () => {
    if (enviando || grupos === null) return;
    setEnviando(true);
    setError(null);
    try {
      await enviarFn(
        jobId,
        textos.map((texto) => ({ texto })),
        { baseUrl },
      );
      onEnviado?.();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'No se pudo enviar el texto editado.',
      );
      setEnviando(false);
    }
  }, [enviando, grupos, jobId, textos, baseUrl, enviarFn, onEnviado]);

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-editor-border bg-editor-panel p-4"
      data-testid="subtitle-review"
    >
      <div>
        <h3 className="text-lg font-medium text-white">Revisar subtítulos</h3>
        <p className="mt-1 text-sm text-gray-400">
          Edita el texto de cada línea (corrige ortografía o palabras mal
          transcritas). Al aceptar se quemarán los subtítulos y se terminará el
          video.
        </p>
      </div>

      {cargando && (
        <p data-testid="review-cargando" className="text-sm text-gray-300">
          Cargando subtítulos…
        </p>
      )}

      {error && (
        <p role="alert" data-testid="review-error" className="text-sm text-red-400">
          {error}
        </p>
      )}

      {grupos && grupos.length > 0 && (
        <ul className="flex flex-col gap-2">
          {grupos.map((g, i) => (
            <li key={i} className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">
                {fmtTiempo(g.inicio_s)} – {fmtTiempo(g.fin_s)}
              </span>
              <input
                type="text"
                value={textos[i] ?? ''}
                data-testid={`review-linea-${i}`}
                onChange={(e) =>
                  setTextos((prev) => {
                    const copia = [...prev];
                    copia[i] = e.target.value;
                    return copia;
                  })
                }
                className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-white"
              />
            </li>
          ))}
        </ul>
      )}

      {grupos && grupos.length === 0 && !cargando && (
        <p className="text-sm text-gray-400">
          No se detectaron subtítulos para revisar.
        </p>
      )}

      <button
        type="button"
        onClick={aceptar}
        disabled={enviando || cargando || grupos === null}
        data-testid="review-aceptar"
        className="self-start rounded bg-green-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {enviando ? 'Enviando…' : 'Aceptar y continuar'}
      </button>
    </div>
  );
}
