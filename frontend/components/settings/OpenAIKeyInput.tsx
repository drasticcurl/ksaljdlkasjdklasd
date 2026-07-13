'use client';

/**
 * OpenAIKeyInput — Campo para la clave de API de OpenAI (corrección con IA).
 *
 * Componente controlado: la clave vive SOLO en el estado de React del
 * componente padre (props `value`/`onChange`). NO se escribe en `localStorage`,
 * `sessionStorage`, cookies ni en ningún almacenamiento persistente: es
 * transitoria y viaja únicamente en `POST /procesar` (spec subtitulos-ia-remotion).
 *
 * Incluye un aviso de privacidad explícito: la clave se envía a OpenAI solo al
 * procesar y no se guarda en ningún sitio.
 *
 * Requisitos: 2.1, 12.1.
 */

import { useId, useState } from 'react';

export interface OpenAIKeyInputProps {
  /** Valor actual de la clave (estado del padre; nunca persistido). */
  value: string;
  /** Notifica cada cambio de la clave al padre. */
  onChange: (value: string) => void;
  /** Si el campo está deshabilitado (p. ej. cuando la IA está desactivada). */
  disabled?: boolean;
}

export default function OpenAIKeyInput({
  value,
  onChange,
  disabled = false,
}: OpenAIKeyInputProps) {
  // Mostrar/ocultar la clave es solo una comodidad visual; no altera el hecho
  // de que la clave nunca se persiste.
  const [visible, setVisible] = useState(false);
  const inputId = useId();

  return (
    <div
      className="flex flex-col gap-2 rounded border border-gray-700 p-3"
      data-testid="openai-key-input"
    >
      <label
        htmlFor={inputId}
        className="text-sm font-semibold text-gray-200"
      >
        Clave de API de OpenAI
      </label>

      <div className="flex items-center gap-2">
        <input
          id={inputId}
          type={visible ? 'text' : 'password'}
          value={value}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-..."
          data-testid="campo-openai-api-key"
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 rounded border border-gray-600 bg-gray-800 px-2 py-1 text-white disabled:opacity-50"
        />
        <button
          type="button"
          disabled={disabled}
          data-testid="openai-key-toggle-visibilidad"
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
          className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 disabled:opacity-50"
        >
          {visible ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>

      <p className="text-xs text-gray-500" data-testid="openai-key-aviso">
        Tu clave se usa solo para enviar el texto de los subtítulos a OpenAI al
        procesar y <strong>no se guarda</strong> en ningún sitio: no se escribe
        en disco ni en el navegador y se descarta al terminar el trabajo.
      </p>
    </div>
  );
}
