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

import type { AjustesSilencios, ModoSilencio } from '@/lib/types';
import NumberField from './NumberField';
import { MODOS_SILENCIO, RANGOS_UI } from './ranges';

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

      <label className="flex flex-col gap-1 text-sm text-gray-300">
        <span>Método</span>
        <select
          value={valor.modo}
          data-testid="campo-silencios.modo"
          onChange={(e) =>
            onChange({ ...valor, modo: e.target.value as ModoSilencio })
          }
          className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-white"
        >
          {MODOS_SILENCIO.map((m) => (
            <option key={m.valor} value={m.valor}>
              {m.etiqueta}
            </option>
          ))}
        </select>
      </label>

      {/* El umbral en dB solo aplica al método por volumen. */}
      {valor.modo === 'db' && (
        <NumberField
          etiqueta="Umbral de silencio"
          campo="silencios.umbral_db"
          unidad="dB"
          valor={valor.umbral_db}
          rango={RANGOS_UI['silencios.umbral_db']}
          onChange={(umbral_db) => onChange({ ...valor, umbral_db })}
        />
      )}

      {valor.modo === 'voz' && (
        <p className="text-xs text-gray-500">
          Detecta la voz con IA y recorta lo demás (ignora el umbral de dB).
        </p>
      )}

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
