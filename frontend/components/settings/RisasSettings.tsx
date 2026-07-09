'use client';

/**
 * RisasSettings — Panel para quitar las risas (jaja/jeje/...) del video.
 *
 * Componente controlado: recibe `valor` (`AjustesRisas`) y `onChange`. Permite
 * activar/desactivar el recorte de risas y ajustar el margen (ms) que se recorta
 * a cada lado de cada risa. La detección es best-effort: depende de que la
 * transcripción escriba la risa como texto.
 */

import type { AjustesRisas } from '@/lib/types';
import NumberField from './NumberField';
import { RANGOS_UI } from './ranges';

export interface RisasSettingsProps {
  valor: AjustesRisas;
  onChange: (valor: AjustesRisas) => void;
}

export default function RisasSettings({ valor, onChange }: RisasSettingsProps) {
  return (
    <fieldset
      className="flex flex-col gap-3 rounded border border-gray-700 p-3"
      data-testid="risas-settings"
    >
      <legend className="px-1 text-sm font-semibold text-gray-200">
        Quitar risas
      </legend>

      <label className="flex items-center gap-2 text-sm text-gray-300">
        <input
          type="checkbox"
          checked={valor.activado}
          data-testid="campo-risas.activado"
          onChange={(e) => onChange({ ...valor, activado: e.target.checked })}
        />
        <span>Recortar las risas (jaja, jeje, ...) del video</span>
      </label>

      {valor.activado && (
        <NumberField
          etiqueta="Margen"
          campo="risas.margen_ms"
          unidad="ms"
          paso={10}
          valor={valor.margen_ms}
          rango={RANGOS_UI['risas.margen_ms']}
          onChange={(margen_ms) => onChange({ ...valor, margen_ms })}
        />
      )}

      <p className="text-xs text-gray-500">
        Detecta las risas por la transcripción y corta esos tramos. No atrapa la
        risa que el modelo no transcribe.
      </p>
    </fieldset>
  );
}
