'use client';

/**
 * GeneralSettings — Panel de ajustes generales: Resolución_Objetivo (ancho/alto)
 * y Cuadros_Por_Segundo_Objetivo (fps).
 *
 * Componente controlado: recibe `valor` (`AjustesGenerales`) y `onChange`.
 * Valida cada campo contra su rango de la UI y señala el campo inválido a través
 * de `NumberField` (Req 9.3, 3.2, 3.5).
 *
 * Requisitos: 9.3.
 */

import type { AjustesGenerales } from '@/lib/types';
import NumberField from './NumberField';
import { RANGOS_UI } from './ranges';

export interface GeneralSettingsProps {
  valor: AjustesGenerales;
  onChange: (valor: AjustesGenerales) => void;
}

export default function GeneralSettings({
  valor,
  onChange,
}: GeneralSettingsProps) {
  return (
    <fieldset
      className="flex flex-col gap-3 rounded border border-gray-700 p-3"
      data-testid="general-settings"
    >
      <legend className="px-1 text-sm font-semibold text-gray-200">
        Ajustes generales
      </legend>

      <NumberField
        etiqueta="Ancho"
        campo="generales.resolucion.ancho"
        unidad="px"
        valor={valor.resolucion.ancho}
        rango={RANGOS_UI['generales.resolucion.ancho']}
        onChange={(ancho) =>
          onChange({
            ...valor,
            resolucion: { ...valor.resolucion, ancho },
          })
        }
      />

      <NumberField
        etiqueta="Alto"
        campo="generales.resolucion.alto"
        unidad="px"
        valor={valor.resolucion.alto}
        rango={RANGOS_UI['generales.resolucion.alto']}
        onChange={(alto) =>
          onChange({
            ...valor,
            resolucion: { ...valor.resolucion, alto },
          })
        }
      />

      <NumberField
        etiqueta="Cuadros por segundo"
        campo="generales.fps"
        unidad="fps"
        valor={valor.fps}
        rango={RANGOS_UI['generales.fps']}
        onChange={(fps) => onChange({ ...valor, fps })}
      />
    </fieldset>
  );
}
