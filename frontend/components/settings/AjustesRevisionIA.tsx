'use client';

/**
 * AjustesRevisionIA — Panel de la corrección de subtítulos con IA (OpenAI).
 *
 * Componente controlado: recibe el sub-objeto `revision_ia` de `Ajustes` y su
 * `onChange`. Permite:
 *   - activar/desactivar la corrección con IA (opt-in, Req 1.1);
 *   - elegir el modelo de OpenAI (por defecto `gpt-5.4-nano`, Req 11.1);
 *   - y muestra un aviso de red externa visible SOLO cuando `activado` es `true`
 *     (Req 12.1), por ser la primera dependencia de red externa del sistema.
 *
 * La clave de API NO se gestiona aquí: es transitoria y vive en su propio
 * componente (`OpenAIKeyInput`) y en el estado del padre.
 *
 * Requisitos: 1.1, 12.1.
 */

import type { AjustesRevisionIA as AjustesRevisionIAType } from '@/lib/types';
import { SUPPORTED_OPENAI_MODELS, modeloOpenAIValido } from './ranges';

export interface AjustesRevisionIAProps {
  valor: AjustesRevisionIAType;
  onChange: (valor: AjustesRevisionIAType) => void;
}

export default function AjustesRevisionIA({
  valor,
  onChange,
}: AjustesRevisionIAProps) {
  // Cuando la IA está activada exigimos un modelo del conjunto admitido.
  const modeloInvalido = valor.activado && !modeloOpenAIValido(valor.modelo);

  return (
    <fieldset
      className="flex flex-col gap-3 rounded border border-gray-700 p-3"
      data-testid="revision-ia-settings"
    >
      <legend className="px-1 text-sm font-semibold text-gray-200">
        Corrección con IA (OpenAI)
      </legend>

      <label className="flex items-center gap-2 text-sm text-gray-300">
        <input
          type="checkbox"
          checked={valor.activado}
          data-testid="campo-revision_ia.activado"
          onChange={(e) => onChange({ ...valor, activado: e.target.checked })}
        />
        <span>Corregir la ortografía de los subtítulos con IA</span>
      </label>

      <label className="flex flex-col gap-1 text-sm text-gray-300">
        <span>Modelo</span>
        <select
          value={valor.modelo}
          disabled={!valor.activado}
          aria-invalid={modeloInvalido}
          data-testid="campo-revision_ia.modelo"
          onChange={(e) => onChange({ ...valor, modelo: e.target.value })}
          className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-white disabled:opacity-50"
        >
          {SUPPORTED_OPENAI_MODELS.map((modelo) => (
            <option key={modelo} value={modelo}>
              {modelo}
            </option>
          ))}
        </select>
        {modeloInvalido && (
          <span
            role="alert"
            data-testid="error-revision_ia.modelo"
            className="text-xs text-red-400"
          >
            El modelo seleccionado no está entre los admitidos por OpenAI.
          </span>
        )}
      </label>

      {valor.activado && (
        <p
          role="alert"
          data-testid="revision-ia-aviso-red"
          className="rounded border border-amber-600/50 bg-amber-950/40 px-2 py-1 text-xs text-amber-300"
        >
          Aviso: al activar esta opción, el texto de los subtítulos se enviará a
          los servidores de OpenAI a través de Internet. Es la única
          funcionalidad que sale de tu equipo; el resto del procesamiento es
          100 % local.
        </p>
      )}

      <p className="text-xs text-gray-500">
        Opcional. Corrige solo ortografía y acentos conservando el número, el
        orden y los tiempos de las líneas. Si falla o no hay clave, se conserva
        el texto original y el proceso continúa.
      </p>
    </fieldset>
  );
}
