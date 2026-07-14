/**
 * Tests unitarios básicos de la proyección de estilo (`lib/estilo.ts`):
 * `estiloDesdeAjustes` y `ajustesConEstilo`.
 *
 * Cubren ejemplos concretos de la proyección `AjustesSubtitulos` ↔ `Estilo`
 * (extraída del patrón del playground), la no-mutación de las entradas y la
 * conservación del resto de ajustes. El round-trip exhaustivo (Propiedad P4 con
 * `fast-check`) corresponde a la tarea 2.4.
 */

import { describe, expect, it } from 'vitest';
import { ajustesConEstilo, estiloDesdeAjustes } from '../estilo';
import { AJUSTES_POR_DEFECTO } from '../defaults';
import type { Estilo } from '@/components/remotion/types';

describe('estiloDesdeAjustes', () => {
  it('proyecta los campos de estilo desde AjustesSubtitulos', () => {
    expect(estiloDesdeAjustes(AJUSTES_POR_DEFECTO.subtitulos)).toEqual({
      fuente: 'Poppins',
      tamano: 72,
      color: '#FFFFFF',
      colorResaltado: '#FFE500',
      posVerticalPct: 85,
      animEntradaMs: 300,
      colorBorde: '#000000',
      grosorBorde: 5,
      negrita: true,
    });
  });

  it('no muta los ajustes de entrada', () => {
    const copia = structuredClone(AJUSTES_POR_DEFECTO.subtitulos);
    estiloDesdeAjustes(AJUSTES_POR_DEFECTO.subtitulos);
    expect(AJUSTES_POR_DEFECTO.subtitulos).toEqual(copia);
  });
});

describe('ajustesConEstilo', () => {
  const estilo: Estilo = {
    fuente: 'Inter',
    tamano: 96,
    color: '#112233',
    colorResaltado: '#AABBCC',
    posVerticalPct: 40,
    animEntradaMs: 500,
    colorBorde: '#445566',
    grosorBorde: 8,
    negrita: false,
  };

  it('aplica los campos de estilo sobre una copia de los ajustes', () => {
    const resultado = ajustesConEstilo(AJUSTES_POR_DEFECTO, estilo);
    expect(resultado.subtitulos).toMatchObject({
      fuente: 'Inter',
      tamano: 96,
      color: '#112233',
      color_resaltado: '#AABBCC',
      pos_vertical_pct: 40,
      anim_entrada_ms: 500,
      color_borde: '#445566',
      grosor_borde: 8,
      negrita: false,
    });
  });

  it('conserva los campos no de estilo de subtitulos y el resto de ajustes', () => {
    const resultado = ajustesConEstilo(AJUSTES_POR_DEFECTO, estilo);
    // Campos de subtitulos que NO son de estilo se conservan.
    expect(resultado.subtitulos.max_palabras).toBe(
      AJUSTES_POR_DEFECTO.subtitulos.max_palabras,
    );
    expect(resultado.subtitulos.preset).toBe(
      AJUSTES_POR_DEFECTO.subtitulos.preset,
    );
    // El resto de secciones de Ajustes se conserva por referencia (no cambian).
    expect(resultado.generales).toEqual(AJUSTES_POR_DEFECTO.generales);
    expect(resultado.render).toEqual(AJUSTES_POR_DEFECTO.render);
  });

  it('no muta los ajustes base', () => {
    const copia = structuredClone(AJUSTES_POR_DEFECTO);
    ajustesConEstilo(AJUSTES_POR_DEFECTO, estilo);
    expect(AJUSTES_POR_DEFECTO).toEqual(copia);
  });

  it('round-trip: estiloDesdeAjustes ∘ ajustesConEstilo devuelve el estilo (P4)', () => {
    const resultado = estiloDesdeAjustes(
      ajustesConEstilo(AJUSTES_POR_DEFECTO, estilo).subtitulos,
    );
    expect(resultado).toEqual(estilo);
  });
});
