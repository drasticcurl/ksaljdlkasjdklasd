'use client';

/**
 * MusicUploader — Selección de música (audio) y ajuste de volumen base (Req 8.1,
 * 9.4, 9.7).
 *
 * Responsabilidades:
 *   - Seleccionar un archivo de audio (WAV, MP3, AAC/M4A, OGG/Opus, FLAC, ...).
 *     Si el archivo no tiene un formato de audio soportado, rechazar la
 *     selección y mostrar un mensaje indicando los formatos aceptados (Req 9.7)
 *     sin intentar subirlo.
 *   - Subir el archivo a `POST /musica` mediante `api.subirMusica` (Req 8.1).
 *   - Ajustar el volumen base de la música (0..100 %) (Req 9.4).
 *   - Notificar `musica_id` y el volumen base al contenedor vía callback.
 *
 * Requisitos: 8.1, 9.4, 9.7.
 */

import { useCallback, useRef, useState } from 'react';
import { subirMusica, ApiError } from '@/lib/api';
import {
  RANGOS_UI,
  EXTENSIONES_AUDIO,
  esArchivoAudio,
  numeroEnRango,
} from './settings/ranges';

/** Valor del atributo `accept` del input: `audio/*` más las extensiones concretas. */
const ACCEPT_AUDIO = ['audio/*', ...EXTENSIONES_AUDIO].join(',');

export interface MusicUploaderProps {
  /**
   * Se invoca cuando cambia la música o su volumen. `musicaId` es `null` cuando
   * no hay música válida cargada (se omitirá el paso 5 del pipeline).
   */
  onMusicaChange?: (info: {
    musicaId: string | null;
    volumenBasePct: number;
  }) => void;
  /** Inyección opcional de la función de subida (por defecto `api.subirMusica`). */
  subir?: typeof subirMusica;
  /** Volumen base inicial (0..100 %); por defecto 30. */
  volumenInicial?: number;
}

const RANGO_VOLUMEN = RANGOS_UI['musica.volumen_base_pct'];

export default function MusicUploader({
  onMusicaChange,
  subir = subirMusica,
  volumenInicial = 30,
}: MusicUploaderProps) {
  const [volumen, setVolumen] = useState<number>(volumenInicial);
  const [musicaId, setMusicaId] = useState<string | null>(null);
  const [nombre, setNombre] = useState<string | null>(null);
  const [errorFormato, setErrorFormato] = useState<string | null>(null);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  const volumenInvalido = !numeroEnRango(volumen, RANGO_VOLUMEN);

  const manejarSeleccion = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      setErrorEnvio(null);
      if (!file) return;

      // Req 9.7: rechazar formatos de audio no soportados indicando los aceptados.
      if (!esArchivoAudio(file.name)) {
        setErrorFormato(
          `"${file.name}": formato no válido. Se requiere un archivo de audio ` +
            `(${EXTENSIONES_AUDIO.join(', ')}).`,
        );
        setMusicaId(null);
        setNombre(null);
        onMusicaChange?.({ musicaId: null, volumenBasePct: volumen });
        if (inputRef.current) inputRef.current.value = '';
        return;
      }

      setErrorFormato(null);
      setSubiendo(true);
      try {
        const respuesta = await subir(file);
        setMusicaId(respuesta.musica_id);
        setNombre(respuesta.nombre_original);
        onMusicaChange?.({
          musicaId: respuesta.musica_id,
          volumenBasePct: volumen,
        });
      } catch (error) {
        const mensaje =
          error instanceof ApiError
            ? error.message
            : 'Error inesperado al subir la música.';
        setErrorEnvio(`No se pudo subir la música: ${mensaje}`);
      } finally {
        setSubiendo(false);
      }
    },
    [subir, volumen, onMusicaChange],
  );

  const manejarVolumen = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nuevo = event.target.value === '' ? NaN : Number(event.target.value);
      setVolumen(nuevo);
      if (numeroEnRango(nuevo, RANGO_VOLUMEN)) {
        onMusicaChange?.({ musicaId, volumenBasePct: nuevo });
      }
    },
    [musicaId, onMusicaChange],
  );

  return (
    <fieldset
      className="flex flex-col gap-3 rounded border border-gray-700 p-3"
      data-testid="music-uploader"
    >
      <legend className="px-1 text-sm font-semibold text-gray-200">
        Música de fondo
      </legend>

      <label className="flex flex-col gap-1 text-sm text-gray-300">
        <span>Selecciona un archivo de audio</span>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_AUDIO}
          onChange={manejarSeleccion}
          data-testid="music-input"
          aria-label="Seleccionar música (archivo de audio)"
        />
      </label>

      {errorFormato && (
        <p role="alert" data-testid="error-formato" className="text-sm text-red-400">
          {errorFormato}
        </p>
      )}

      {errorEnvio && (
        <p role="alert" data-testid="error-envio" className="text-sm text-red-400">
          {errorEnvio}
        </p>
      )}

      {subiendo && (
        <p data-testid="subiendo" className="text-sm text-gray-400">
          Subiendo música…
        </p>
      )}

      {musicaId && nombre && (
        <p data-testid="musica-cargada" className="text-sm text-green-400">
          Música cargada: {nombre}
        </p>
      )}

      <label className="flex flex-col gap-1 text-sm text-gray-300">
        <span>
          Volumen base (%)
          <span className="text-gray-500">
            {' '}
            [{RANGO_VOLUMEN.min}..{RANGO_VOLUMEN.max}]
          </span>
        </span>
        <input
          type="range"
          min={RANGO_VOLUMEN.min}
          max={RANGO_VOLUMEN.max}
          step={1}
          value={Number.isFinite(volumen) ? volumen : RANGO_VOLUMEN.min}
          data-testid="campo-volumen"
          aria-invalid={volumenInvalido}
          onChange={manejarVolumen}
        />
        <span data-testid="valor-volumen" className="text-xs text-gray-400">
          {Number.isFinite(volumen) ? `${volumen}%` : '—'}
        </span>
        {volumenInvalido && (
          <span
            role="alert"
            data-testid="error-volumen"
            className="text-xs text-red-400"
          >
            {`El volumen base debe estar entre ${RANGO_VOLUMEN.min} y ${RANGO_VOLUMEN.max} %.`}
          </span>
        )}
      </label>
    </fieldset>
  );
}
