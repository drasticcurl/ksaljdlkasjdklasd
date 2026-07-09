'use client';

/**
 * SettingsActions — Acciones de configuración por defecto del usuario.
 *
 * Permite "Guardar como predeterminado" el conjunto actual de ajustes (se
 * persiste en un JSON local del backend vía `PUT /configuracion`) y
 * "Restablecer" a los valores de fábrica (borra el JSON con `DELETE
 * /configuracion` y devuelve los ajustes por defecto al contenedor).
 *
 * Es un componente controlado: no muta los ajustes directamente; el
 * restablecimiento se delega en `onRestablecer` para que el contenedor aplique
 * los valores de fábrica.
 */

import { useCallback, useState } from 'react';
import {
  ApiError,
  borrarConfiguracion,
  guardarConfiguracion,
} from '@/lib/api';
import type { Ajustes } from '@/lib/types';

export interface SettingsActionsProps {
  /** Ajustes actuales a guardar como predeterminados. */
  ajustes: Ajustes;
  /** Se invoca al restablecer, para que el contenedor aplique los de fábrica. */
  onRestablecer: () => void;
  /** Inyección opcional (tests). */
  guardarFn?: typeof guardarConfiguracion;
  borrarFn?: typeof borrarConfiguracion;
}

type Estado =
  | { tipo: 'idle' }
  | { tipo: 'ok'; mensaje: string }
  | { tipo: 'error'; mensaje: string };

export default function SettingsActions({
  ajustes,
  onRestablecer,
  guardarFn = guardarConfiguracion,
  borrarFn = borrarConfiguracion,
}: SettingsActionsProps) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'idle' });
  const [ocupado, setOcupado] = useState(false);

  const guardar = useCallback(async () => {
    if (ocupado) return;
    setOcupado(true);
    setEstado({ tipo: 'idle' });
    try {
      await guardarFn(ajustes);
      setEstado({ tipo: 'ok', mensaje: 'Configuración guardada como predeterminada.' });
    } catch (error) {
      const mensaje =
        error instanceof ApiError
          ? error.message
          : 'No se pudo guardar la configuración.';
      setEstado({ tipo: 'error', mensaje });
    } finally {
      setOcupado(false);
    }
  }, [ocupado, ajustes, guardarFn]);

  const restablecer = useCallback(async () => {
    if (ocupado) return;
    setOcupado(true);
    setEstado({ tipo: 'idle' });
    try {
      await borrarFn();
      onRestablecer();
      setEstado({ tipo: 'ok', mensaje: 'Se restablecieron los valores de fábrica.' });
    } catch (error) {
      const mensaje =
        error instanceof ApiError
          ? error.message
          : 'No se pudo restablecer la configuración.';
      setEstado({ tipo: 'error', mensaje });
    } finally {
      setOcupado(false);
    }
  }, [ocupado, borrarFn, onRestablecer]);

  return (
    <div className="flex flex-col gap-2" data-testid="settings-actions">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={guardar}
          disabled={ocupado}
          data-testid="guardar-config"
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          Guardar como predeterminado
        </button>
        <button
          type="button"
          onClick={restablecer}
          disabled={ocupado}
          data-testid="restablecer-config"
          className="rounded border border-gray-500 px-3 py-1.5 text-sm font-medium text-gray-200 disabled:opacity-50"
        >
          Restablecer
        </button>
      </div>
      {estado.tipo !== 'idle' && (
        <p
          role="status"
          data-testid="config-mensaje"
          className={
            estado.tipo === 'ok' ? 'text-xs text-green-400' : 'text-xs text-red-400'
          }
        >
          {estado.mensaje}
        </p>
      )}
    </div>
  );
}
