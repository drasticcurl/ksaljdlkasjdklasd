'use client';

/**
 * SilenceSettings — Panel de ajustes del corte de silencios.
 *
 * Componente controlado: recibe `valor` (`AjustesSilencios`) y `onChange`.
 * Permite activar/desactivar el paso y configurar el umbral (-60..0 dB) y el
 * margen (0..5000 ms), validando cada campo contra su rango de la UI y señalando
 * el campo inválido (Req 9.2).
 *
 * Requisitos: 9.2.
 */

import type { AjustesSilencios } from '@/lib/types';
import NumberField from './NumberField';
import { RANGOS_UI } from './ranges';

export interface SilenceSettingsProps {
  valor: AjustesSilencios;
  onChange: (valor: AjustesSilencios) => void;
}

export default function SilenceSettings({
  valor,
  onChange,
}: SilenceSettingsProps) {
  return (
    <fieldset
      className="flex flex-col gap-3 rounded border border-gray-700 p-3"
      data-testid="silence-settings"
    >
      <legend className="px-1 text-sm font-semibold text-gray-200">
        Corte de silencios
      </legend>

      <label className="flex items-center gap-2 text-sm text-gray-300">
        <input
          type="checkbox"
          checked={valor.activado}
          data-testid="campo-silencios.activado"
          onChange={(e) => onChange({ ...valor, activado: e.target.checked })}
        />
        <span>Activar corte de silencios</span>
      </label>

      <NumberField
        etiqueta="Umbral de silencio"
        campo="silencios.umbral_db"
        unidad="dB"
        valor={valor.umbral_db}
        rango={RANGOS_UI['silencios.umbral_db']}
        onChange={(umbral_db) => onChange({ ...valor, umbral_db })}
      />

      <NumberField
        etiqueta="Margen"
        campo="silencios.margen_ms"
        unidad="ms"
        paso={10}
        valor={valor.margen_ms}
        rango={RANGOS_UI['silencios.margen_ms']}
        onChange={(margen_ms) => onChange({ ...valor, margen_ms })}
      />
    </fieldset>
  );
}
