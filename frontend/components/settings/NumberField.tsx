'use client';

/**
 * NumberField — Campo numérico controlado reutilizable por los paneles de
 * ajustes (`components/settings/*`).
 *
 * Valida el valor contra su rango de la UI (Req 9.6): si el valor está fuera de
 * rango (o no es numérico) muestra un mensaje que **identifica el campo
 * inválido** y marca el input con `aria-invalid`. Notifica cada cambio mediante
 * `onChange` con el número parseado (o `NaN` cuando el input está vacío/no es
 * numérico), delegando en el contenedor la decisión de persistir el valor.
 *
 * Requisitos: 9.1, 9.2, 9.3, 9.4, 9.6.
 */

import { useId } from 'react';
import { numeroEnRango, type RangoUI } from './ranges';

export interface NumberFieldProps {
  /** Etiqueta legible del campo. */
  etiqueta: string;
  /** Ruta con puntos del campo (usada como `data-testid` estable). */
  campo: string;
  /** Valor actual (controlado). */
  valor: number;
  /** Rango de la UI `[min, max]` contra el que se valida. */
  rango: RangoUI;
  /** Se invoca con el nuevo valor numérico (`NaN` si el input queda inválido). */
  onChange: (valor: number) => void;
  /** Paso del input numérico (por defecto 1). */
  paso?: number;
  /** Sufijo de unidad opcional mostrado junto a la etiqueta (p. ej. "ms", "%"). */
  unidad?: string;
}

export default function NumberField({
  etiqueta,
  campo,
  valor,
  rango,
  onChange,
  paso = 1,
  unidad,
}: NumberFieldProps) {
  const id = useId();
  const invalido = !numeroEnRango(valor, rango);

  return (
    <label className="flex flex-col gap-1 text-sm text-gray-300" htmlFor={id}>
      <span>
        {etiqueta}
        {unidad ? ` (${unidad})` : ''}{' '}
        <span className="text-gray-500">
          [{rango.min}..{rango.max}]
        </span>
      </span>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={rango.min}
        max={rango.max}
        step={paso}
        value={Number.isFinite(valor) ? valor : ''}
        aria-invalid={invalido}
        data-testid={`campo-${campo}`}
        onChange={(e) => {
          const texto = e.target.value;
          onChange(texto === '' ? NaN : Number(texto));
        }}
        className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-white aria-[invalid=true]:border-red-500"
      />
      {invalido && (
        <span
          role="alert"
          data-testid={`error-${campo}`}
          className="text-xs text-red-400"
        >
          {`El campo "${etiqueta}" debe estar entre ${rango.min} y ${rango.max}.`}
        </span>
      )}
    </label>
  );
}
