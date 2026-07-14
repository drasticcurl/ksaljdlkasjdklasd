'use client';

/**
 * Componente `EstiloSubtitulos` — controles de estilo de subtítulos REUTILIZABLES.
 *
 * Encapsula los controles de estilo que HOY están duplicados en `/playground`
 * (`app/playground/page.tsx`): color del texto, color de resaltado, tamaño,
 * fuente, posición vertical, animación de entrada, color de borde, grosor de
 * borde y negrita.
 *
 * Es un COMPONENTE CONTROLADO PURO: recibe el `estilo` actual y emite cada
 * cambio mediante `onChange` con una copia inmutable del estilo actualizado. No
 * conoce nada del Job ni de la persistencia (eso lo gestionan sus consumidores:
 * el playground y, más adelante, `PreviewRemotionReal`).
 *
 * Reutiliza EXACTAMENTE los mismos `data-testid` que el playground para que los
 * tests existentes sigan funcionando cuando el playground lo consuma (tarea 4.2):
 * `estilo-color`, `estilo-color-resaltado`, `estilo-tamano`, `estilo-fuente`,
 * `estilo-pos-vertical`, `estilo-anim-entrada`, `estilo-color-borde`,
 * `estilo-grosor-borde` y `estilo-negrita`.
 *
 * Requisitos: 4.1, 4.2, 4.3.
 */

import type { Estilo } from '@/components/remotion/types';
import { FUENTES_DISPONIBLES } from '@/components/settings/ranges';

/** Props del componente controlado de estilo de subtítulos. */
export interface EstiloSubtitulosProps {
  /** Estilo actual mostrado por los controles. */
  estilo: Estilo;
  /** Se invoca con el estilo actualizado (inmutable) ante cualquier cambio. */
  onChange: (estilo: Estilo) => void;
}

/**
 * Renderiza los controles de estilo de los subtítulos. Cada control refleja el
 * campo correspondiente de `estilo` y, al modificarse, llama a `onChange` con
 * una copia inmutable del estilo con ese único campo actualizado.
 */
export default function EstiloSubtitulos({
  estilo,
  onChange,
}: EstiloSubtitulosProps) {
  /** Emite `onChange` con una copia inmutable del estilo y un campo cambiado. */
  function actualizarEstilo<K extends keyof Estilo>(campo: K, valor: Estilo[K]) {
    onChange({ ...estilo, [campo]: valor });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm text-gray-300">
          <span>Color del texto</span>
          <input
            type="color"
            data-testid="estilo-color"
            value={estilo.color}
            onChange={(e) => actualizarEstilo('color', e.target.value)}
            className="h-8 w-16 rounded border border-gray-600 bg-gray-800"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-gray-300">
          <span>Color de resaltado</span>
          <input
            type="color"
            data-testid="estilo-color-resaltado"
            value={estilo.colorResaltado}
            onChange={(e) => actualizarEstilo('colorResaltado', e.target.value)}
            className="h-8 w-16 rounded border border-gray-600 bg-gray-800"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm text-gray-300">
        <span>Tamaño: {estilo.tamano}px</span>
        <input
          type="range"
          min={12}
          max={200}
          step={1}
          data-testid="estilo-tamano"
          value={estilo.tamano}
          onChange={(e) => actualizarEstilo('tamano', Number(e.target.value))}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-gray-300">
        <span>Fuente</span>
        <select
          data-testid="estilo-fuente"
          value={estilo.fuente}
          onChange={(e) => actualizarEstilo('fuente', e.target.value)}
          className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-white"
        >
          {FUENTES_DISPONIBLES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm text-gray-300">
        <span>Posición vertical: {estilo.posVerticalPct}%</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          data-testid="estilo-pos-vertical"
          value={estilo.posVerticalPct}
          onChange={(e) =>
            actualizarEstilo('posVerticalPct', Number(e.target.value))
          }
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-gray-300">
        <span>Animación de entrada: {estilo.animEntradaMs}ms</span>
        <input
          type="range"
          min={0}
          max={2000}
          step={50}
          data-testid="estilo-anim-entrada"
          value={estilo.animEntradaMs}
          onChange={(e) =>
            actualizarEstilo('animEntradaMs', Number(e.target.value))
          }
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm text-gray-300">
          <span>Color de borde</span>
          <input
            type="color"
            data-testid="estilo-color-borde"
            value={estilo.colorBorde}
            onChange={(e) => actualizarEstilo('colorBorde', e.target.value)}
            className="h-8 w-16 rounded border border-gray-600 bg-gray-800"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-gray-300">
          <span>
            Grosor de borde: {estilo.grosorBorde}px
            {estilo.grosorBorde === 0 ? ' (sin borde)' : ''}
          </span>
          <input
            type="range"
            min={0}
            max={20}
            step={1}
            data-testid="estilo-grosor-borde"
            value={estilo.grosorBorde}
            onChange={(e) =>
              actualizarEstilo('grosorBorde', Number(e.target.value))
            }
          />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-300">
        <input
          type="checkbox"
          data-testid="estilo-negrita"
          checked={estilo.negrita}
          onChange={(e) => actualizarEstilo('negrita', e.target.checked)}
          className="h-4 w-4 rounded border border-gray-600 bg-gray-800"
        />
        <span>Negrita</span>
      </label>
    </div>
  );
}
