'use client';

/**
 * TranscriptionSettings — Panel de ajustes de transcripción: idioma y modelo de
 * faster-whisper (cada uno seleccionado de su lista de valores admitidos) y la
 * Resolución_Objetivo (ancho/alto).
 *
 * Componente controlado: recibe los ajustes de transcripción y la resolución
 * objetivo junto con sus `onChange`. Idioma y modelo se eligen de listas de
 * valores admitidos (Req 9.3); la resolución valida su rango de la UI y señala
 * el campo inválido.
 *
 * Requisitos: 9.3.
 */

import type {
  AjustesTranscripcion,
  ResolucionObjetivo,
} from '@/lib/types';
import NumberField from './NumberField';
import {
  RANGOS_UI,
  SUPPORTED_WHISPER_MODELS,
  idiomaValido,
  idiomasSeleccionables,
  modeloValido,
} from './ranges';

export interface TranscriptionSettingsProps {
  valor: AjustesTranscripcion;
  onChange: (valor: AjustesTranscripcion) => void;
  /** Resolución objetivo (Req 9.3): ancho/alto. */
  resolucion: ResolucionObjetivo;
  onResolucionChange: (valor: ResolucionObjetivo) => void;
}

export default function TranscriptionSettings({
  valor,
  onChange,
  resolucion,
  onResolucionChange,
}: TranscriptionSettingsProps) {
  const idiomaInvalido = !idiomaValido(valor.idioma);
  const modeloInvalido = !modeloValido(valor.modelo);

  return (
    <fieldset
      className="flex flex-col gap-3 rounded border border-gray-700 p-3"
      data-testid="transcription-settings"
    >
      <legend className="px-1 text-sm font-semibold text-gray-200">
        Transcripción
      </legend>

      <label className="flex flex-col gap-1 text-sm text-gray-300">
        <span>Idioma</span>
        <select
          value={valor.idioma}
          aria-invalid={idiomaInvalido}
          data-testid="campo-transcripcion.idioma"
          onChange={(e) => onChange({ ...valor, idioma: e.target.value })}
          className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-white"
        >
          {idiomasSeleccionables().map((idioma) => (
            <option key={idioma} value={idioma}>
              {idioma === 'auto' ? 'auto (detección automática)' : idioma}
            </option>
          ))}
        </select>
        {idiomaInvalido && (
          <span
            role="alert"
            data-testid="error-transcripcion.idioma"
            className="text-xs text-red-400"
          >
            El idioma seleccionado no está entre los admitidos.
          </span>
        )}
      </label>

      <label className="flex flex-col gap-1 text-sm text-gray-300">
        <span>Modelo</span>
        <select
          value={valor.modelo}
          aria-invalid={modeloInvalido}
          data-testid="campo-transcripcion.modelo"
          onChange={(e) => onChange({ ...valor, modelo: e.target.value })}
          className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-white"
        >
          {SUPPORTED_WHISPER_MODELS.map((modelo) => (
            <option key={modelo} value={modelo}>
              {modelo}
            </option>
          ))}
        </select>
        {modeloInvalido && (
          <span
            role="alert"
            data-testid="error-transcripcion.modelo"
            className="text-xs text-red-400"
          >
            El modelo seleccionado no está entre los admitidos.
          </span>
        )}
      </label>

      <NumberField
        etiqueta="Resolución objetivo — Ancho"
        campo="generales.resolucion.ancho"
        unidad="px"
        valor={resolucion.ancho}
        rango={RANGOS_UI['generales.resolucion.ancho']}
        onChange={(ancho) => onResolucionChange({ ...resolucion, ancho })}
      />

      <NumberField
        etiqueta="Resolución objetivo — Alto"
        campo="generales.resolucion.alto"
        unidad="px"
        valor={resolucion.alto}
        rango={RANGOS_UI['generales.resolucion.alto']}
        onChange={(alto) => onResolucionChange({ ...resolucion, alto })}
      />
    </fieldset>
  );
}
