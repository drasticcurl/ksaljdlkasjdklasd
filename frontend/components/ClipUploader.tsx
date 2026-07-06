'use client';

/**
 * ClipUploader — Selección y validación de clips (Req 1).
 *
 * Responsabilidades:
 *   - Permitir seleccionar 1..50 clips de video (input múltiple).
 *   - Validar la selección ANTES de enviar usando `lib/validation.ts`:
 *       · Rechazar la selección completa si excede 50 archivos (Req 1.5).
 *       · Rechazar por archivo los formatos no soportados o > 500 MB,
 *         mostrando un motivo por cada archivo rechazado y conservando los
 *         válidos (Req 1.4).
 *   - Enviar los clips válidos por multipart a `POST /clips` mediante
 *     `api.subirClips` (Req 1.1), que impone el timeout de 60 s (Req 1.7).
 *   - Ante timeout o error de red, mostrar un mensaje de carga incompleta y
 *     CONSERVAR la selección para permitir un reintento (Req 1.7).
 *
 * Requisitos: 1.1, 1.4, 1.5, 1.7.
 */

import { useCallback, useRef, useState } from 'react';
import { subirClips, ApiError, CLIENT_ERROR_CODES } from '@/lib/api';
import {
  validarSeleccion,
  type RechazoClip,
} from '@/lib/validation';
import type { Clip } from '@/lib/types';

export interface ClipUploaderProps {
  /** Se invoca con los clips almacenados por el backend tras una subida OK. */
  onClipsSubidos?: (clips: Clip[]) => void;
  /**
   * Inyección opcional de la función de subida (por defecto `api.subirClips`).
   * Útil para pruebas; en producción no se pasa.
   */
  subir?: typeof subirClips;
}

/** Estado del error de envío mostrado al usuario. */
interface ErrorEnvio {
  mensaje: string;
  /** `true` cuando el fallo permite reintentar conservando la selección. */
  reintentable: boolean;
}

/**
 * Traduce un error de `subirClips` a un mensaje para el usuario. Los fallos de
 * timeout (60 s) y de red son reintentables y conservan la selección (Req 1.7).
 */
function describirErrorEnvio(error: unknown): ErrorEnvio {
  if (error instanceof ApiError) {
    if (error.code === CLIENT_ERROR_CODES.TIMEOUT) {
      return {
        mensaje:
          'La carga no se completó: se agotó el tiempo de espera (60 s). ' +
          'Tu selección se conservó; puedes reintentar.',
        reintentable: true,
      };
    }
    if (error.code === CLIENT_ERROR_CODES.NETWORK) {
      return {
        mensaje:
          'La carga no se completó por un error de red. ' +
          'Tu selección se conservó; puedes reintentar.',
        reintentable: true,
      };
    }
    // Error del backend (formato/tamaño revalidado, almacenamiento, etc.).
    return {
      mensaje: `La carga no se completó: ${error.message}`,
      reintentable: true,
    };
  }
  return {
    mensaje:
      'La carga no se completó por un error inesperado. ' +
      'Tu selección se conservó; puedes reintentar.',
    reintentable: true,
  };
}

export default function ClipUploader({
  onClipsSubidos,
  subir = subirClips,
}: ClipUploaderProps) {
  /** Clips válidos pendientes de subir; se conservan para reintento (Req 1.7). */
  const [seleccion, setSeleccion] = useState<File[]>([]);
  /** Rechazos por archivo (formato/tamaño) con su motivo (Req 1.4). */
  const [rechazos, setRechazos] = useState<RechazoClip<File>[]>([]);
  /** Mensaje del límite de 50 archivos (Req 1.5); null si no aplica. */
  const [errorLimite, setErrorLimite] = useState<string | null>(null);
  /** Error de envío (timeout/red/backend) (Req 1.7). */
  const [errorEnvio, setErrorEnvio] = useState<ErrorEnvio | null>(null);
  /** Indica que hay una subida en curso. */
  const [subiendo, setSubiendo] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  const manejarSeleccion = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      // Nueva selección: se limpia cualquier error de envío previo.
      setErrorEnvio(null);

      if (files.length === 0) {
        return;
      }

      const resultado = validarSeleccion(files);

      if (resultado.limiteExcedido) {
        // Se rechaza la selección completa (Req 1.5), conservando lo anterior.
        setErrorLimite(resultado.mensajeLimite);
        return;
      }

      setErrorLimite(null);
      setSeleccion(resultado.aceptados);
      setRechazos(resultado.rechazados);
    },
    [],
  );

  const manejarEnvio = useCallback(async () => {
    if (seleccion.length === 0 || subiendo) return;

    setSubiendo(true);
    setErrorEnvio(null);
    try {
      const respuesta = await subir(seleccion);
      // Éxito: se limpia la selección y se notifica al contenedor (Tarea 20.4).
      onClipsSubidos?.(respuesta.clips);
      setSeleccion([]);
      setRechazos([]);
      if (inputRef.current) inputRef.current.value = '';
    } catch (error) {
      // Req 1.7: conservar la selección y permitir reintento.
      setErrorEnvio(describirErrorEnvio(error));
    } finally {
      setSubiendo(false);
    }
  }, [seleccion, subiendo, subir, onClipsSubidos]);

  return (
    <div className="flex flex-col gap-3" data-testid="clip-uploader">
      <label className="flex flex-col gap-1 text-sm text-gray-300">
        <span>Selecciona entre 1 y 50 clips de video</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="video/*,.mp4,.mov,.m4v,.mkv,.webm,.avi"
          onChange={manejarSeleccion}
          data-testid="clip-input"
          aria-label="Seleccionar clips de video"
        />
      </label>

      {errorLimite && (
        <p role="alert" data-testid="error-limite" className="text-sm text-red-400">
          {errorLimite}
        </p>
      )}

      {rechazos.length > 0 && (
        <ul data-testid="rechazos" className="flex flex-col gap-1">
          {rechazos.map((rechazo, i) => (
            <li
              key={`${rechazo.archivo.name}-${i}`}
              role="alert"
              className="text-sm text-red-400"
            >
              {rechazo.mensaje}
            </li>
          ))}
        </ul>
      )}

      {seleccion.length > 0 && (
        <ul data-testid="seleccion" className="flex flex-col gap-1 text-sm text-gray-300">
          {seleccion.map((file, i) => (
            <li key={`${file.name}-${i}`}>{file.name}</li>
          ))}
        </ul>
      )}

      {errorEnvio && (
        <p role="alert" data-testid="error-envio" className="text-sm text-red-400">
          {errorEnvio.mensaje}
        </p>
      )}

      <button
        type="button"
        onClick={manejarEnvio}
        disabled={seleccion.length === 0 || subiendo}
        data-testid="subir-clips"
        className="self-start rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {subiendo
          ? 'Subiendo…'
          : errorEnvio?.reintentable
            ? 'Reintentar subida'
            : `Subir ${seleccion.length} clip${seleccion.length === 1 ? '' : 's'}`}
      </button>
    </div>
  );
}
