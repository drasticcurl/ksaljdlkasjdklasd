'use client';

/**
 * TransitionSettings — Panel de ajustes de la transición entre clips.
 *
 * Componente controlado: recibe `valor` (`AjustesTransiciones`) y `onChange`.
 * Permite elegir un único tipo de transición (aplicado entre todos los clips) y
 * su duración en ms. La duración solo es relevante cuando hay un efecto activo
 * (tipo distinto de `ninguna`), por lo que el campo se muestra en ese caso.
 */

import type { AjustesTransiciones, TipoTransicion } from '@/lib/types';
import NumberField from './NumberField';
import { RANGOS_UI, TIPOS_TRANSICION } from './ranges';

export interface TransitionSettingsProps {
  valor: AjustesTransiciones;
  onChange: (valor: AjustesTransiciones) => void;
}

export default function TransitionSettings({
  valor,
  onChange,
}: TransitionSettingsProps) {
  const hayEfecto = valor.tipo !== 'ninguna';

  return (
    <fieldset
      className="flex flex-col gap-3 rounded border border-gray-700 p-3"
      data-testid="transition-settings"
    >
      <legend className="px-1 text-sm font-semibold text-gray-200">
        Transiciones entre clips
      </legend>

      <label className="flex flex-col gap-1 text-sm text-gray-300">
        <span>Tipo de transición</span>
        <select
          value={valor.tipo}
          data-testid="campo-transiciones.tipo"
          onChange={(e) =>
            onChange({ ...valor, tipo: e.target.value as TipoTransicion })
          }
          className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-white"
        >
          {TIPOS_TRANSICION.map((t) => (
            <option key={t.valor} value={t.valor}>
              {t.etiqueta}
            </option>
          ))}
        </select>
      </label>

      {hayEfecto && (
        <NumberField
          etiqueta="Duración de la transición"
          campo="transiciones.duracion_ms"
          unidad="ms"
          paso={50}
          valor={valor.duracion_ms}
          rango={RANGOS_UI['transiciones.duracion_ms']}
          onChange={(duracion_ms) => onChange({ ...valor, duracion_ms })}
        />
      )}

      <p className="text-xs text-gray-500">
        Se aplica el mismo efecto entre todos los clips. Activar transiciones
        recodifica el video al unir (un poco más lento que el corte directo).
      </p>
    </fieldset>
  );
}
