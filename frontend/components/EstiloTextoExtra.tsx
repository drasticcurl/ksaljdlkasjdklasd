'use client';

/**
 * Componente `EstiloTextoExtra` — controles de estilo INDEPENDIENTE de un texto
 * extra tipo "hook".
 *
 * Es el componente HERMANO de `EstiloSubtitulos`: reutiliza EXACTAMENTE los
 * mismos tipos de control (color pickers, sliders y checkbox) y los mismos
 * rangos del motor, pero opera sobre el estilo INDEPENDIENTE de un texto extra
 * (`EstiloTextoExtra` de `lib/types.ts`), desacoplado del estilo de los
 * subtítulos (Req 9.4, 18.2; design §3.2).
 *
 * A diferencia de `EstiloSubtitulos`, aquí NO hay color de resaltado ni
 * animación de entrada (los textos extra son texto plano sin animación,
 * Req 9.5) y SÍ se expone la posición horizontal, ya que el texto extra se
 * coloca libremente en los dos ejes mediante porcentajes (Req 9.4).
 *
 * Es un COMPONENTE CONTROLADO PURO: recibe el `estilo` actual y emite cada
 * cambio mediante `onChange` con una copia inmutable del estilo actualizado. No
 * conoce nada del texto, sus tiempos, el Job ni la persistencia (eso lo
 * gestiona su consumidor `TextosExtra`).
 *
 * Rangos del motor (mismos que subtítulos): `tamano` 12..200, `grosorBorde`
 * 0..20, `posVerticalPct`/`posHorizontalPct` 0..100 y colores `#RRGGBB`.
 *
 * Requisitos: 9.4, 9.5, 18.2.
 */

import type { EstiloTextoExtra } from '@/lib/types';
import { FUENTES_DISPONIBLES } from '@/components/settings/ranges';

/** Props del componente controlado de estilo de un texto extra. */
export interface EstiloTextoExtraProps {
  /** Estilo actual mostrado por los controles. */
  estilo: EstiloTextoExtra;
  /** Se invoca con el estilo actualizado (inmutable) ante cualquier cambio. */
  onChange: (estilo: EstiloTextoExtra) => void;
  /**
   * Prefijo opcional para los `data-testid` de los controles. Permite montar
   * varios paneles (uno por texto extra) sin colisiones de identificadores.
   * Por defecto `"estilo-texto-extra"`.
   */
  testIdPrefix?: string;
}

/**
 * Estilo INDEPENDIENTE por defecto para un texto extra recién creado. Sus
 * valores coinciden con los `default` del modelo del backend
 * (`models/settings.py: EstiloTextoExtra`) para mantener coherencia entre
 * frontend y backend.
 */
export const ESTILO_TEXTO_EXTRA_POR_DEFECTO: EstiloTextoExtra = {
  fuente: FUENTES_DISPONIBLES[0],
  tamano: 64,
  color: '#FFFFFF',
  colorBorde: '#000000',
  grosorBorde: 6,
  negrita: true,
  posVerticalPct: 20,
  posHorizontalPct: 50,
};

/**
 * Renderiza los controles de estilo de un texto extra. Cada control refleja el
 * campo correspondiente de `estilo` y, al modificarse, llama a `onChange` con
 * una copia inmutable del estilo con ese único campo actualizado.
 */
export default function EstiloTextoExtra({
  estilo,
  onChange,
  testIdPrefix = 'estilo-texto-extra',
}: EstiloTextoExtraProps) {
  /** Emite `onChange` con una copia inmutable del estilo y un campo cambiado. */
  function actualizarEstilo<K extends keyof EstiloTextoExtra>(
    campo: K,
    valor: EstiloTextoExtra[K],
  ) {
    onChange({ ...estilo, [campo]: valor });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm text-gray-300">
          <span>Color del texto</span>
          <input
            type="color"
            data-testid={`${testIdPrefix}-color`}
            value={estilo.color}
            onChange={(e) => actualizarEstilo('color', e.target.value)}
            className="h-8 w-16 rounded border border-gray-600 bg-gray-800"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-gray-300">
          <span>Color de borde</span>
          <input
            type="color"
            data-testid={`${testIdPrefix}-color-borde`}
            value={estilo.colorBorde}
            onChange={(e) => actualizarEstilo('colorBorde', e.target.value)}
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
          data-testid={`${testIdPrefix}-tamano`}
          value={estilo.tamano}
          onChange={(e) => actualizarEstilo('tamano', Number(e.target.value))}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-gray-300">
        <span>Fuente</span>
        <select
          data-testid={`${testIdPrefix}-fuente`}
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
        <span>
          Grosor de borde: {estilo.grosorBorde}px
          {estilo.grosorBorde === 0 ? ' (sin borde)' : ''}
        </span>
        <input
          type="range"
          min={0}
          max={20}
          step={1}
          data-testid={`${testIdPrefix}-grosor-borde`}
          value={estilo.grosorBorde}
          onChange={(e) =>
            actualizarEstilo('grosorBorde', Number(e.target.value))
          }
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-gray-300">
        <span>Posición vertical: {estilo.posVerticalPct}%</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          data-testid={`${testIdPrefix}-pos-vertical`}
          value={estilo.posVerticalPct}
          onChange={(e) =>
            actualizarEstilo('posVerticalPct', Number(e.target.value))
          }
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-gray-300">
        <span>Posición horizontal: {estilo.posHorizontalPct}%</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          data-testid={`${testIdPrefix}-pos-horizontal`}
          value={estilo.posHorizontalPct}
          onChange={(e) =>
            actualizarEstilo('posHorizontalPct', Number(e.target.value))
          }
        />
      </label>

      <label className="flex items-center gap-2 text-sm text-gray-300">
        <input
          type="checkbox"
          data-testid={`${testIdPrefix}-negrita`}
          checked={estilo.negrita}
          onChange={(e) => actualizarEstilo('negrita', e.target.checked)}
          className="h-4 w-4 rounded border border-gray-600 bg-gray-800"
        />
        <span>Negrita</span>
      </label>
    </div>
  );
}
