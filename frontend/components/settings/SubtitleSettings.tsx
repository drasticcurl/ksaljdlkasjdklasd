'use client';

/**
 * SubtitleSettings — Panel de ajustes de subtítulos y su animación.
 *
 * Componente controlado: recibe `valor` (`AjustesSubtitulos`) y `onChange`.
 * Expone todos los campos del Req 9.1 dentro de sus rangos de la UI: posición
 * vertical/horizontal (enum + %), márgenes, fuente, tamaño, color y color de
 * borde, grosor de borde, negrita, máximo de palabras, duración de la animación
 * de entrada/salida y píxeles de deslizamiento. Cada campo numérico valida su
 * rango y señala el campo inválido (vía `NumberField`); los colores validan el
 * formato `#RRGGBB`.
 *
 * Requisitos: 9.1.
 */

import type {
  AjustesSubtitulos,
  PosicionHorizontal,
  PosicionVertical,
} from '@/lib/types';
import NumberField from './NumberField';
import {
  FUENTES_DISPONIBLES,
  PRESETS_SUBTITULO,
  RANGOS_UI,
  colorValido,
} from './ranges';
import type { PresetSubtitulo } from '@/lib/types';

export interface SubtitleSettingsProps {
  valor: AjustesSubtitulos;
  onChange: (valor: AjustesSubtitulos) => void;
}

const POSICIONES_VERTICALES: PosicionVertical[] = [
  'superior',
  'centro',
  'inferior',
];
const POSICIONES_HORIZONTALES: PosicionHorizontal[] = [
  'izquierda',
  'centro',
  'derecha',
];

function CampoColor({
  etiqueta,
  campo,
  valor,
  onChange,
}: {
  etiqueta: string;
  campo: string;
  valor: string;
  onChange: (valor: string) => void;
}) {
  const invalido = !colorValido(valor);
  return (
    <label className="flex flex-col gap-1 text-sm text-gray-300">
      <span>{etiqueta}</span>
      <input
        type="color"
        value={colorValido(valor) ? valor : '#000000'}
        aria-invalid={invalido}
        data-testid={`campo-${campo}`}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-16 rounded border border-gray-600 bg-gray-800"
      />
      {invalido && (
        <span
          role="alert"
          data-testid={`error-${campo}`}
          className="text-xs text-red-400"
        >
          {`El campo "${etiqueta}" debe tener formato #RRGGBB.`}
        </span>
      )}
    </label>
  );
}

export default function SubtitleSettings({
  valor,
  onChange,
}: SubtitleSettingsProps) {
  return (
    <fieldset
      className="flex flex-col gap-3 rounded border border-gray-700 p-3"
      data-testid="subtitle-settings"
    >
      <legend className="px-1 text-sm font-semibold text-gray-200">
        Subtítulos
      </legend>

      <label className="flex flex-col gap-1 text-sm text-gray-300">
        <span>Estilo</span>
        <select
          value={valor.preset}
          data-testid="campo-subtitulos.preset"
          onChange={(e) =>
            onChange({ ...valor, preset: e.target.value as PresetSubtitulo })
          }
          className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-white"
        >
          {PRESETS_SUBTITULO.map((p) => (
            <option key={p.valor} value={p.valor}>
              {p.etiqueta}
            </option>
          ))}
        </select>
      </label>

      {valor.preset !== 'clasico' && (
        <CampoColor
          etiqueta="Color de acento (palabra activa)"
          campo="subtitulos.color_resaltado"
          valor={valor.color_resaltado}
          onChange={(color_resaltado) => onChange({ ...valor, color_resaltado })}
        />
      )}

      <label className="flex flex-col gap-1 text-sm text-gray-300">
        <span>Posición vertical</span>
        <select
          value={valor.posicion_vertical}
          data-testid="campo-subtitulos.posicion_vertical"
          onChange={(e) =>
            onChange({
              ...valor,
              posicion_vertical: e.target.value as PosicionVertical,
            })
          }
          className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-white"
        >
          {POSICIONES_VERTICALES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm text-gray-300">
        <span>Posición horizontal</span>
        <select
          value={valor.posicion_horizontal}
          data-testid="campo-subtitulos.posicion_horizontal"
          onChange={(e) =>
            onChange({
              ...valor,
              posicion_horizontal: e.target.value as PosicionHorizontal,
            })
          }
          className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-white"
        >
          {POSICIONES_HORIZONTALES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>

      <NumberField
        etiqueta="Posición vertical"
        campo="subtitulos.pos_vertical_pct"
        unidad="%"
        valor={valor.pos_vertical_pct}
        rango={RANGOS_UI['subtitulos.pos_vertical_pct']}
        onChange={(pos_vertical_pct) =>
          onChange({ ...valor, pos_vertical_pct })
        }
      />

      <NumberField
        etiqueta="Posición horizontal"
        campo="subtitulos.pos_horizontal_pct"
        unidad="%"
        valor={valor.pos_horizontal_pct}
        rango={RANGOS_UI['subtitulos.pos_horizontal_pct']}
        onChange={(pos_horizontal_pct) =>
          onChange({ ...valor, pos_horizontal_pct })
        }
      />

      <NumberField
        etiqueta="Margen"
        campo="subtitulos.margen_px"
        unidad="px"
        valor={valor.margen_px}
        rango={RANGOS_UI['subtitulos.margen_px']}
        onChange={(margen_px) => onChange({ ...valor, margen_px })}
      />

      <label className="flex flex-col gap-1 text-sm text-gray-300">
        <span>Fuente</span>
        <select
          value={valor.fuente}
          data-testid="campo-subtitulos.fuente"
          onChange={(e) => onChange({ ...valor, fuente: e.target.value })}
          className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-white"
        >
          {FUENTES_DISPONIBLES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>

      <NumberField
        etiqueta="Tamaño"
        campo="subtitulos.tamano"
        unidad="px"
        valor={valor.tamano}
        rango={RANGOS_UI['subtitulos.tamano']}
        onChange={(tamano) => onChange({ ...valor, tamano })}
      />

      <CampoColor
        etiqueta="Color"
        campo="subtitulos.color"
        valor={valor.color}
        onChange={(color) => onChange({ ...valor, color })}
      />

      <CampoColor
        etiqueta="Color de borde"
        campo="subtitulos.color_borde"
        valor={valor.color_borde}
        onChange={(color_borde) => onChange({ ...valor, color_borde })}
      />

      <NumberField
        etiqueta="Grosor de borde"
        campo="subtitulos.grosor_borde"
        unidad="px"
        valor={valor.grosor_borde}
        rango={RANGOS_UI['subtitulos.grosor_borde']}
        onChange={(grosor_borde) => onChange({ ...valor, grosor_borde })}
      />

      <label className="flex items-center gap-2 text-sm text-gray-300">
        <input
          type="checkbox"
          checked={valor.negrita}
          data-testid="campo-subtitulos.negrita"
          onChange={(e) => onChange({ ...valor, negrita: e.target.checked })}
        />
        <span>Negrita</span>
      </label>

      <NumberField
        etiqueta="Máximo de palabras por subtítulo"
        campo="subtitulos.max_palabras"
        valor={valor.max_palabras}
        rango={RANGOS_UI['subtitulos.max_palabras']}
        onChange={(max_palabras) => onChange({ ...valor, max_palabras })}
      />

      <label className="flex items-center gap-2 text-sm text-gray-300">
        <input
          type="checkbox"
          checked={valor.minusculas}
          data-testid="campo-subtitulos.minusculas"
          onChange={(e) => onChange({ ...valor, minusculas: e.target.checked })}
        />
        <span>Todo el texto en minúscula</span>
      </label>

      <label className="flex items-center gap-2 text-sm text-gray-300">
        <input
          type="checkbox"
          checked={valor.revisar}
          data-testid="campo-subtitulos.revisar"
          onChange={(e) => onChange({ ...valor, revisar: e.target.checked })}
        />
        <span>Revisar y editar el texto antes de quemar los subtítulos</span>
      </label>

      <NumberField
        etiqueta="Animación de entrada"
        campo="subtitulos.anim_entrada_ms"
        unidad="ms"
        paso={50}
        valor={valor.anim_entrada_ms}
        rango={RANGOS_UI['subtitulos.anim_entrada_ms']}
        onChange={(anim_entrada_ms) => onChange({ ...valor, anim_entrada_ms })}
      />

      <NumberField
        etiqueta="Animación de salida"
        campo="subtitulos.anim_salida_ms"
        unidad="ms"
        paso={50}
        valor={valor.anim_salida_ms}
        rango={RANGOS_UI['subtitulos.anim_salida_ms']}
        onChange={(anim_salida_ms) => onChange({ ...valor, anim_salida_ms })}
      />

      <NumberField
        etiqueta="Píxeles de deslizamiento"
        campo="subtitulos.slide_px"
        unidad="px"
        valor={valor.slide_px}
        rango={RANGOS_UI['subtitulos.slide_px']}
        onChange={(slide_px) => onChange({ ...valor, slide_px })}
      />
    </fieldset>
  );
}
