'use client';

/**
 * ResultPreview — Previsualización y descarga del Video_Final (Tarea 20.3).
 *
 * Al completar un Job muestra:
 *   - Una previsualización reproducible del Video_Final mediante un elemento
 *     `<video>` cuyo `src` apunta a `GET /descargar/{id}` (Req 11.1).
 *   - Un botón/enlace de descarga que apunta al mismo endpoint
 *     `GET /descargar/{id}` con el atributo `download` (Req 11.2).
 *   - Un fallback: si la previsualización no puede cargarse (`onError` del
 *     `<video>`), se oculta el reproductor y se muestra un mensaje indicando que
 *     la previsualización no está disponible, conservando la opción de descarga
 *     (Req 11.5).
 *
 * Requisitos: 11.1, 11.2, 11.5.
 */

import { useCallback, useState } from 'react';
import { urlDescarga } from '@/lib/api';

export interface ResultPreviewProps {
  /** Id del Job completado cuyo Video_Final se previsualiza/descarga. */
  jobId: string;
  /** URL base del backend (se propaga a la construcción de la URL). */
  baseUrl?: string;
  /**
   * Inyección opcional del constructor de URL de descarga (por defecto
   * `api.urlDescarga`). Útil para pruebas.
   */
  urlDescargaFn?: typeof urlDescarga;
  /** Nombre de archivo sugerido para la descarga. */
  nombreArchivo?: string;
}

export default function ResultPreview({
  jobId,
  baseUrl,
  urlDescargaFn = urlDescarga,
  nombreArchivo = 'video-final.mp4',
}: ResultPreviewProps) {
  /** `true` cuando la previsualización no pudo cargarse (Req 11.5). */
  const [previewFallida, setPreviewFallida] = useState(false);

  const url = urlDescargaFn(jobId, baseUrl);

  const manejarErrorVideo = useCallback(() => {
    // Req 11.5: si la previsualización no carga, mostrar mensaje + descarga.
    setPreviewFallida(true);
  }, []);

  return (
    <div className="flex flex-col gap-3" data-testid="result-preview">
      <h3 className="text-sm font-semibold text-green-400">
        ¡Video listo!
      </h3>

      {!previewFallida ? (
        <video
          data-testid="result-video"
          src={url}
          controls
          playsInline
          preload="metadata"
          onError={manejarErrorVideo}
          className="max-h-[70vh] w-full rounded border border-gray-700 bg-black"
        />
      ) : (
        <p
          role="alert"
          data-testid="result-preview-error"
          className="text-sm text-yellow-400"
        >
          No se pudo cargar la previsualización del video. Puedes descargarlo
          para verlo en tu reproductor.
        </p>
      )}

      {/* Descarga vía GET /descargar/{id} (Req 11.2), siempre disponible. */}
      <a
        href={url}
        download={nombreArchivo}
        data-testid="result-descargar"
        className="self-start rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white"
      >
        Descargar video
      </a>
    </div>
  );
}
