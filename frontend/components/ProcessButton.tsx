'use client';

/**
 * ProcessButton — Disparo del procesamiento (Tarea 20.1).
 *
 * Responsabilidades:
 *   - Validación global PREVIA al envío (Req 9.5, 9.6): comprueba que existe al
 *     menos 1 clip en el `Orden_de_Clips` vigente y que TODOS los ajustes están
 *     dentro de rango. Si algo es inválido, bloquea el envío, muestra un mensaje
 *     que identifica el campo inválido y conserva los ajustes (Req 9.6) — este
 *     componente no muta los ajustes, que viven en el contenedor.
 *   - Si todo es válido, envía `POST /procesar` con el `Orden_de_Clips` vigente
 *     + los ajustes + `musica_id` mediante `api.procesar` (Req 2.3, 9.5) y
 *     notifica el `job_id` iniciado vía `onJobIniciado`.
 *   - Si el envío falla, muestra un mensaje de error del envío conservando los
 *     ajustes sin iniciar el procesamiento (Req 9.8).
 *
 * Requisitos: 2.3, 9.5, 9.6, 9.8.
 */

import { useCallback, useState } from 'react';
import { procesar, ApiError } from '@/lib/api';
import type { Ajustes, ProcesarRequest } from '@/lib/types';
import {
  validarProcesamiento,
  type ResultadoValidacion,
} from '@/lib/validacion-ajustes';

export interface ProcessButtonProps {
  /** Orden de clips vigente (ids) en el momento de procesar (Req 2.3). */
  ordenClips: string[];
  /** Conjunto completo de ajustes configurados en la UI (Req 9.5). */
  ajustes: Ajustes;
  /** Id de música opcional; `null` si no se agregó WAV. */
  musicaId: string | null;
  /** Se invoca con el `job_id` cuando el Job se inicia correctamente. */
  onJobIniciado?: (jobId: string) => void;
  /**
   * Inyección opcional de la función de envío (por defecto `api.procesar`).
   * Útil para pruebas; en producción no se pasa.
   */
  procesarFn?: typeof procesar;
}

export default function ProcessButton({
  ordenClips,
  ajustes,
  musicaId,
  onJobIniciado,
  procesarFn = procesar,
}: ProcessButtonProps) {
  /** Resultado de la validación global bloqueante (Req 9.6). */
  const [errorValidacion, setErrorValidacion] =
    useState<ResultadoValidacion | null>(null);
  /** Mensaje de error del envío de `POST /procesar` (Req 9.8). */
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  /** Indica que hay un envío en curso. */
  const [enviando, setEnviando] = useState(false);

  const manejarProcesar = useCallback(async () => {
    if (enviando) return;

    // Nueva acción: limpiar errores previos de envío.
    setErrorEnvio(null);

    // Validación global previa (Req 9.6): si falla, bloquear e identificar el
    // campo inválido sin tocar los ajustes.
    const validacion = validarProcesamiento(ordenClips, ajustes);
    if (!validacion.valido) {
      setErrorValidacion(validacion);
      return;
    }
    setErrorValidacion(null);

    const peticion: ProcesarRequest = {
      orden_clips: ordenClips,
      musica_id: musicaId,
      ajustes,
    };

    setEnviando(true);
    try {
      const respuesta = await procesarFn(peticion);
      onJobIniciado?.(respuesta.job_id);
    } catch (error) {
      // Req 9.8: mostrar fallo del envío y conservar los ajustes (no se
      // modifica el estado de ajustes; solo se muestra el error).
      const mensaje =
        error instanceof ApiError
          ? error.message
          : 'Error inesperado al iniciar el procesamiento.';
      setErrorEnvio(`No se pudo iniciar el procesamiento: ${mensaje}`);
    } finally {
      setEnviando(false);
    }
  }, [enviando, ordenClips, ajustes, musicaId, procesarFn, onJobIniciado]);

  return (
    <div className="flex flex-col gap-2" data-testid="process-button">
      <button
        type="button"
        onClick={manejarProcesar}
        disabled={enviando}
        data-testid="procesar"
        className="self-start rounded bg-green-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {enviando ? 'Iniciando…' : 'Procesar video'}
      </button>

      {errorValidacion && !errorValidacion.valido && (
        <p
          role="alert"
          data-testid="error-validacion"
          data-campo={errorValidacion.campoInvalido}
          className="text-sm text-red-400"
        >
          {errorValidacion.mensaje}
        </p>
      )}

      {errorEnvio && (
        <p role="alert" data-testid="error-envio" className="text-sm text-red-400">
          {errorEnvio}
        </p>
      )}
    </div>
  );
}
