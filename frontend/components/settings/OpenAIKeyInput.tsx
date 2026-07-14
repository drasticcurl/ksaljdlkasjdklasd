'use client';

/**
 * OpenAIKeyInput — Campo para la clave de API de OpenAI (corrección con IA).
 *
 * Componente controlado: la clave vive en el estado de React del componente
 * padre (props `value`/`onChange`). Además, como comodidad, se PERSISTE en el
 * `localStorage` del navegador (clave `openai_api_key`) para no reintroducirla
 * en cada sesión (spec edicion-avanzada-shorts, §9 / Req 12).
 *
 * IMPLICACIÓN DE SEGURIDAD (design §9, S5): persistir la clave en `localStorage`
 * la deja legible por cualquier script del mismo origen (expuesta a XSS). Es una
 * decisión que el usuario asume explícitamente; por eso se muestra un aviso de
 * seguridad visible y se ofrece el botón "Olvidar clave", que la borra de
 * `localStorage`. La clave NUNCA se persiste en el backend ni se registra en
 * logs (solo viaja en `POST /procesar` y vive en el mapa transitorio del Job).
 *
 * La PRECARGA desde `localStorage` al montar la app la realiza el padre
 * (`page.tsx`, tarea 10.8 / Req 12.2); este componente se centra en GUARDAR al
 * escribir, OLVIDAR bajo demanda y mostrar el aviso.
 *
 * Requisitos: 2.1, 12.1, 12.3, 12.4.
 */

import { useId, useState } from 'react';

import { guardarApiKeyLocal, olvidarApiKeyLocal } from '@/lib/api';

export interface OpenAIKeyInputProps {
  /** Valor actual de la clave (estado del padre; también persistido en localStorage). */
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
  // Mostrar/ocultar la clave es solo una comodidad visual.
  const [visible, setVisible] = useState(false);
  // Indicador efímero de que la clave se ha olvidado (feedback visual).
  const [olvidada, setOlvidada] = useState(false);
  const inputId = useId();

  /**
   * Al escribir la clave: notifica al padre (componente controlado) y, además,
   * la persiste en `localStorage` (Req 12.1). Cualquier edición cancela el
   * mensaje de "clave olvidada".
   */
  const alCambiar = (nueva: string) => {
    onChange(nueva);
    guardarApiKeyLocal(nueva);
    if (olvidada) setOlvidada(false);
  };

  /**
   * "Olvidar clave": borra la clave de `localStorage`, vacía el campo mediante
   * el padre (`onChange('')`) y muestra feedback visual (Req 12.3).
   */
  const alOlvidar = () => {
    olvidarApiKeyLocal();
    onChange('');
    setOlvidada(true);
  };

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
          onChange={(e) => alCambiar(e.target.value)}
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
        <button
          type="button"
          disabled={disabled || value.length === 0}
          data-testid="openai-key-olvidar"
          onClick={alOlvidar}
          className="rounded border border-red-700 px-2 py-1 text-xs text-red-300 disabled:opacity-50"
        >
          Olvidar clave
        </button>
      </div>

      {olvidada && (
        <p
          className="text-xs text-green-400"
          role="status"
          data-testid="openai-key-olvidada-feedback"
        >
          Clave eliminada del navegador.
        </p>
      )}

      <p
        className="text-xs text-amber-400"
        role="note"
        data-testid="openai-key-aviso"
      >
        <strong>Aviso de seguridad:</strong> tu clave se{' '}
        <strong>almacena en este navegador</strong> (localStorage) para no tener
        que reintroducirla en cada sesión. Esto implica que queda accesible para
        cualquier script del mismo origen (por ejemplo, ante un ataque XSS). Usa{' '}
        <strong>«Olvidar clave»</strong> para borrarla del navegador. La clave no
        se guarda en el backend ni se registra en ningún log.
      </p>
    </div>
  );
}
