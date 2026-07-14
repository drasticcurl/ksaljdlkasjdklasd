'use client';

/**
 * Componente `TextosExtra` — gestión de una lista de 0..2 textos extra tipo
 * "hook" aplicados al vídeo final (design §3.2; Req 9.1–9.6, 18.2).
 *
 * Cada texto extra es un overlay de texto PLANO SIN ANIMACIÓN (Req 9.5) que se
 * define por:
 *   - un `texto`,
 *   - un rango temporal de entrada/salida (in/out) EN SEGUNDOS, y
 *   - un estilo INDEPENDIENTE (panel `EstiloTextoExtra`, hermano de
 *     `EstiloSubtitulos`).
 *
 * Es un COMPONENTE CONTROLADO: la lista de textos es la fuente de verdad del
 * consumidor (más adelante `PreviewFinal`, tarea 10.6). Recibe `textos` y emite
 * la nueva lista mediante `onChange` ante cualquier edición, sin mantener estado
 * propio de la lista.
 *
 * CONVENCIÓN DE UNIDADES (decisión de conversión, documentada):
 *   - El MODELO (`TextoExtra` de `lib/types.ts`) almacena los tiempos en
 *     MILISEGUNDOS (`inicioMs`/`finMs`), coherente con el contrato de la
 *     composición Remotion.
 *   - La UI expone al usuario los tiempos en SEGUNDOS (Req 9.3).
 *   - La conversión es puntual y consistente en ambos sentidos:
 *       segundos→ms: `Math.round(segundos * 1000)`  (evita deriva de coma
 *                    flotante y garantiza enteros de ms),
 *       ms→segundos: `ms / 1000`.
 *     Se usa `Math.round` al escribir para que el ida y vuelta sea estable para
 *     valores de segundos con hasta 3 decimales.
 *
 * VALIDACIÓN del rango temporal (Req 9.3, 9.6): cada texto es válido si y solo
 * si `0 <= in < out <= duracionS`. Cuando un texto es inválido se muestra un
 * mensaje de error visible y se informa al consumidor mediante `onValidezChange`
 * para que pueda IMPEDIR la confirmación del render (la confirmación vive en
 * `PreviewFinal`, tarea 10.6).
 *
 * Requisitos: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 18.2.
 */

import { useEffect } from 'react';
import type { TextoExtra } from '@/lib/types';
import EstiloTextoExtra, {
  ESTILO_TEXTO_EXTRA_POR_DEFECTO,
} from '@/components/EstiloTextoExtra';

/** Número máximo de textos extra permitidos (Req 9.1, 9.2). */
export const MAX_TEXTOS_EXTRA = 2;

/** Props del componente controlado de gestión de textos extra. */
export interface TextosExtraProps {
  /** Lista actual de textos extra (0..2). Fuente de verdad del consumidor. */
  textos: TextoExtra[];
  /** Duración total del vídeo cortado, en segundos (cota superior de `out`). */
  duracionS: number;
  /** Se invoca con la nueva lista (inmutable) ante cualquier edición. */
  onChange: (textos: TextoExtra[]) => void;
  /**
   * Callback opcional que informa si TODOS los textos tienen un rango temporal
   * válido. Permite al consumidor (p. ej. `PreviewFinal`) deshabilitar el botón
   * de confirmar/renderizar mientras haya errores (Req 9.6).
   */
  onValidezChange?: (todosValidos: boolean) => void;
}

/** Convierte milisegundos a segundos para mostrarlos en la UI. */
export function msASegundos(ms: number): number {
  return ms / 1000;
}

/** Convierte segundos (UI) a milisegundos enteros para el modelo. */
export function segundosAMs(segundos: number): number {
  return Math.round(segundos * 1000);
}

/**
 * Valida el rango temporal de un texto extra contra `duracionS` y devuelve un
 * mensaje de error en español, o `null` si el rango es válido.
 *
 * Regla (Req 9.3, 9.6): `0 <= in < out <= duracionS`, con `in`/`out` en ms.
 */
export function validarRangoTextoExtra(
  texto: TextoExtra,
  duracionS: number,
): string | null {
  const inicioS = msASegundos(texto.inicioMs);
  const finS = msASegundos(texto.finMs);
  const duracionMs = segundosAMs(duracionS);

  if (!Number.isFinite(inicioS) || !Number.isFinite(finS)) {
    return 'Los tiempos de entrada y salida deben ser números válidos.';
  }
  if (texto.inicioMs < 0) {
    return 'La entrada (in) no puede ser negativa.';
  }
  if (texto.inicioMs >= texto.finMs) {
    return 'La entrada (in) debe ser menor que la salida (out).';
  }
  if (texto.finMs > duracionMs) {
    return `La salida (out) no puede superar la duración del vídeo (${duracionS.toFixed(2)} s).`;
  }
  return null;
}

/** Indica si TODOS los textos de la lista tienen un rango temporal válido. */
export function textosExtraTodosValidos(
  textos: TextoExtra[],
  duracionS: number,
): boolean {
  return textos.every((t) => validarRangoTextoExtra(t, duracionS) === null);
}

/**
 * Crea un texto extra nuevo por defecto: texto vacío, entrada en 0 y salida en
 * `min(3, duracionS)` segundos (rango válido de partida cuando hay duración),
 * con el estilo independiente por defecto.
 */
function crearTextoExtraPorDefecto(duracionS: number): TextoExtra {
  const finS = duracionS > 0 ? Math.min(3, duracionS) : 0;
  return {
    texto: '',
    inicioMs: 0,
    finMs: segundosAMs(finS),
    estilo: { ...ESTILO_TEXTO_EXTRA_POR_DEFECTO },
  };
}

/**
 * Renderiza la lista de textos extra con su botón "Agregar texto", y por cada
 * texto: campo de texto, campos in/out en segundos con validación, panel de
 * estilo independiente y botón de eliminar.
 */
export default function TextosExtra({
  textos,
  duracionS,
  onChange,
  onValidezChange,
}: TextosExtraProps) {
  const alcanzadoMaximo = textos.length >= MAX_TEXTOS_EXTRA;

  // Informa al consumidor de la validez global cada vez que cambian los textos
  // o la duración, para que pueda impedir confirmar mientras haya errores.
  useEffect(() => {
    onValidezChange?.(textosExtraTodosValidos(textos, duracionS));
  }, [textos, duracionS, onValidezChange]);

  /** Añade un texto extra si aún no se alcanzó el máximo (Req 9.1, 9.2). */
  function agregarTexto() {
    if (alcanzadoMaximo) return;
    onChange([...textos, crearTextoExtraPorDefecto(duracionS)]);
  }

  /** Elimina el texto extra en la posición `indice`. */
  function eliminarTexto(indice: number) {
    onChange(textos.filter((_, i) => i !== indice));
  }

  /** Actualiza (inmutablemente) el texto extra en `indice`. */
  function actualizarTexto(indice: number, cambios: Partial<TextoExtra>) {
    onChange(
      textos.map((t, i) => (i === indice ? { ...t, ...cambios } : t)),
    );
  }

  return (
    <div
      className="flex flex-col gap-4 rounded-lg border border-editor-border bg-editor-panel p-4"
      data-testid="textos-extra"
    >
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-white">Textos extra</h3>
          <p className="mt-1 text-sm text-gray-400">
            Añade hasta {MAX_TEXTOS_EXTRA} textos tipo &quot;hook&quot; con su
            rango de tiempo (en segundos) y estilo independiente. Se muestran
            como texto plano, sin animación.
          </p>
        </div>
        <button
          type="button"
          onClick={agregarTexto}
          disabled={alcanzadoMaximo}
          data-testid="textos-extra-agregar"
          className="self-start rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Agregar texto
        </button>
      </div>

      {textos.length === 0 && (
        <p className="text-sm text-gray-400">
          No hay textos extra. Pulsa &quot;Agregar texto&quot; para crear uno.
        </p>
      )}

      <ul className="flex flex-col gap-4">
        {textos.map((t, i) => {
          const errorRango = validarRangoTextoExtra(t, duracionS);
          return (
            <li
              key={i}
              data-testid={`texto-extra-${i}`}
              className="flex flex-col gap-3 rounded border border-gray-700 bg-gray-900/40 p-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-200">
                  Texto {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => eliminarTexto(i)}
                  data-testid={`texto-extra-eliminar-${i}`}
                  className="rounded bg-red-600/80 px-3 py-1 text-xs font-medium text-white"
                >
                  Eliminar
                </button>
              </div>

              <label className="flex flex-col gap-1 text-sm text-gray-300">
                <span>Texto</span>
                <input
                  type="text"
                  value={t.texto}
                  data-testid={`texto-extra-texto-${i}`}
                  onChange={(e) =>
                    actualizarTexto(i, { texto: e.target.value })
                  }
                  className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-white"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-sm text-gray-300">
                  <span>Entrada (in) en segundos</span>
                  <input
                    type="number"
                    min={0}
                    max={duracionS}
                    step={0.1}
                    value={msASegundos(t.inicioMs)}
                    data-testid={`texto-extra-in-${i}`}
                    onChange={(e) =>
                      actualizarTexto(i, {
                        inicioMs: segundosAMs(Number(e.target.value)),
                      })
                    }
                    className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-white"
                  />
                </label>

                <label className="flex flex-col gap-1 text-sm text-gray-300">
                  <span>Salida (out) en segundos</span>
                  <input
                    type="number"
                    min={0}
                    max={duracionS}
                    step={0.1}
                    value={msASegundos(t.finMs)}
                    data-testid={`texto-extra-out-${i}`}
                    onChange={(e) =>
                      actualizarTexto(i, {
                        finMs: segundosAMs(Number(e.target.value)),
                      })
                    }
                    className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-white"
                  />
                </label>
              </div>

              {errorRango && (
                <p
                  role="alert"
                  data-testid={`texto-extra-error-${i}`}
                  className="text-sm text-red-400"
                >
                  {errorRango}
                </p>
              )}

              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium text-gray-200">
                  Estilo del texto
                </span>
                <EstiloTextoExtra
                  estilo={t.estilo}
                  testIdPrefix={`texto-extra-estilo-${i}`}
                  onChange={(estilo) => actualizarTexto(i, { estilo })}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
