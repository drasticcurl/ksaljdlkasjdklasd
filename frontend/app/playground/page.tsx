'use client';

/**
 * Página /playground — Banco de pruebas visual de los subtítulos de Remotion.
 *
 * Objetivo: ver EN VIVO cómo se ven los subtítulos sobre un FONDO BLANCO,
 * escribiendo textos como si fueran la transcripción. Usa `<Player>` de
 * `@remotion/player` con la MISMA composición `ShortVideo` que el render real
 * (copia en `components/remotion/`, sincronizada con `remotion/src/`).
 *
 * Además permite editar el estilo (color, color de resaltado, tamaño, fuente,
 * posición vertical y animación de entrada) y GUARDARLO en la configuración del
 * backend, de modo que ese estilo se use luego en el render real (la página
 * principal carga la config al abrir).
 *
 * Nota: el resaltado karaoke por palabra NO se aprecia aquí, porque los textos
 * de prueba no llevan timing por palabra (grupos con `words: []`). El objetivo
 * de esta página es afinar el ESTILO, no el karaoke.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Player } from '@remotion/player';
import { ShortVideo } from '@/components/remotion/ShortVideo';
import type { Estilo, Grupo, ShortVideoProps } from '@/components/remotion/types';
import { FUENTES_DISPONIBLES } from '@/components/settings/ranges';
import { AJUSTES_POR_DEFECTO } from '@/lib/defaults';
import { obtenerConfiguracion, guardarConfiguracion } from '@/lib/api';

// Parámetros fijos de la composición (formato vertical 9:16 a 30 fps).
const FPS = 30;
const ANCHO = 1080;
const ALTO = 1920;

// Timing simple de los dos grupos de prueba (en milisegundos).
const GRUPO1_INICIO_MS = 0;
const GRUPO1_FIN_MS = 2000;
const GRUPO2_INICIO_MS = 2000;
const GRUPO2_FIN_MS = 4000;

/** Estilo inicial derivado de los ajustes por defecto de subtítulos. */
const ESTILO_INICIAL: Estilo = {
  fuente: AJUSTES_POR_DEFECTO.subtitulos.fuente,
  tamano: AJUSTES_POR_DEFECTO.subtitulos.tamano,
  color: AJUSTES_POR_DEFECTO.subtitulos.color,
  colorResaltado: AJUSTES_POR_DEFECTO.subtitulos.color_resaltado,
  posVerticalPct: AJUSTES_POR_DEFECTO.subtitulos.pos_vertical_pct,
  animEntradaMs: AJUSTES_POR_DEFECTO.subtitulos.anim_entrada_ms,
};

export default function PlaygroundPage() {
  // Textos de prueba (cada uno = un grupo/frase de la transcripción).
  const [texto1, setTexto1] = useState('no te zarpes que es');
  const [texto2, setTexto2] = useState('hincha rápido');

  // Estilo editable en vivo.
  const [estilo, setEstilo] = useState<Estilo>(ESTILO_INICIAL);

  // Estado del botón "Guardar estilo".
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Construye los grupos a partir de los dos textos. `words: []` hace que la
  // composición divida por espacios (sin karaoke). El endMs del último grupo
  // define la duración total.
  const grupos: Grupo[] = useMemo(
    () => [
      {
        text: texto1,
        startMs: GRUPO1_INICIO_MS,
        endMs: GRUPO1_FIN_MS,
        words: [],
      },
      {
        text: texto2,
        startMs: GRUPO2_INICIO_MS,
        endMs: GRUPO2_FIN_MS,
        words: [],
      },
    ],
    [texto1, texto2],
  );

  // Duración total en frames, derivada del fin del último grupo.
  const durationInFrames = useMemo(() => {
    const finMs = grupos[grupos.length - 1]?.endMs ?? 1000;
    return Math.max(1, Math.round((finMs / 1000) * FPS));
  }, [grupos]);

  // Props de entrada de la composición (fondo blanco: videoSrc: '').
  const inputProps: ShortVideoProps = useMemo(
    () => ({
      videoSrc: '',
      fps: FPS,
      width: ANCHO,
      height: ALTO,
      durationInFrames,
      estilo,
      combineTokensWithinMs: AJUSTES_POR_DEFECTO.render.combine_tokens_ms,
      grupos,
    }),
    [durationInFrames, estilo, grupos],
  );

  /** Actualiza un campo del estilo de forma inmutable. */
  function actualizarEstilo<K extends keyof Estilo>(campo: K, valor: Estilo[K]) {
    setEstilo((prev) => ({ ...prev, [campo]: valor }));
  }

  /**
   * Guarda el estilo actual en la configuración del backend: carga la config
   * vigente (o parte de AJUSTES_POR_DEFECTO si no hay), aplica los campos de
   * estilo del playground a `ajustes.subtitulos` y persiste con
   * `guardarConfiguracion`. Así el render real usará este estilo.
   */
  async function guardarEstilo() {
    setGuardando(true);
    setMensaje(null);
    setError(null);
    try {
      const { ajustes: guardados } = await obtenerConfiguracion();
      const base = guardados ?? AJUSTES_POR_DEFECTO;
      const ajustes = {
        ...base,
        subtitulos: {
          ...base.subtitulos,
          color: estilo.color,
          color_resaltado: estilo.colorResaltado,
          tamano: estilo.tamano,
          fuente: estilo.fuente,
          pos_vertical_pct: estilo.posVerticalPct,
          anim_entrada_ms: estilo.animEntradaMs,
        },
      };
      await guardarConfiguracion(ajustes);
      setMensaje('Estilo guardado. Se usará en el render real.');
    } catch (e) {
      setError(
        e instanceof Error
          ? `No se pudo guardar el estilo: ${e.message}`
          : 'No se pudo guardar el estilo.',
      );
    } finally {
      setGuardando(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-6">
      <header className="flex items-start justify-between border-b border-editor-border pb-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">
            Playground de subtítulos
          </h1>
          <p className="mt-1 text-sm text-gray-400">
            Escribe textos como si fueran la transcripción y ajusta el estilo
            para ver en vivo cómo se ven los subtítulos de Remotion sobre un
            fondo blanco.
          </p>
        </div>
        <Link
          href="/"
          className="rounded border border-editor-border px-3 py-2 text-sm text-gray-200 hover:bg-editor-panel"
        >
          ← Volver al editor
        </Link>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Previsualización en vivo. */}
        <section
          aria-label="Previsualización"
          className="flex flex-col items-center gap-3 rounded-lg border border-editor-border bg-editor-panel p-4"
        >
          <h2 className="self-start text-lg font-medium text-white">
            Previsualización
          </h2>
          <div data-testid="player-wrapper">
            <Player
              component={ShortVideo}
              inputProps={inputProps}
              durationInFrames={durationInFrames}
              compositionWidth={ANCHO}
              compositionHeight={ALTO}
              fps={FPS}
              controls
              loop
              // Escala el lienzo 9:16 a un alto cómodo (~640px) manteniendo la
              // proporción (360x640).
              style={{ width: 360, height: 640 }}
            />
          </div>
          <p className="text-xs text-gray-500">
            El resaltado karaoke por palabra no se ve aquí (los textos de prueba
            no tienen timing por palabra). Esta vista sirve para afinar el
            estilo.
          </p>
        </section>

        {/* Controles: textos + estilo. */}
        <section
          aria-label="Controles"
          className="flex flex-col gap-4 rounded-lg border border-editor-border bg-editor-panel p-4"
        >
          <h2 className="text-lg font-medium text-white">Textos de prueba</h2>

          <label className="flex flex-col gap-1 text-sm text-gray-300">
            <span>Texto 1</span>
            <textarea
              data-testid="texto-1"
              value={texto1}
              onChange={(e) => setTexto1(e.target.value)}
              rows={2}
              className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-white"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-gray-300">
            <span>Texto 2</span>
            <textarea
              data-testid="texto-2"
              value={texto2}
              onChange={(e) => setTexto2(e.target.value)}
              rows={2}
              className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-white"
            />
          </label>

          <h2 className="mt-2 text-lg font-medium text-white">Estilo</h2>

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
                onChange={(e) =>
                  actualizarEstilo('colorResaltado', e.target.value)
                }
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
              onChange={(e) =>
                actualizarEstilo('tamano', Number(e.target.value))
              }
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

          <div className="mt-2 flex items-center gap-3 border-t border-editor-border pt-3">
            <button
              type="button"
              data-testid="guardar-estilo"
              onClick={guardarEstilo}
              disabled={guardando}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {guardando ? 'Guardando…' : 'Guardar estilo'}
            </button>
            {mensaje && (
              <span
                role="status"
                data-testid="guardar-mensaje"
                className="text-sm text-green-400"
              >
                {mensaje}
              </span>
            )}
            {error && (
              <span
                role="alert"
                data-testid="guardar-error"
                className="text-sm text-red-400"
              >
                {error}
              </span>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
