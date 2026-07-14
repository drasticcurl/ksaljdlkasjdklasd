/**
 * Tests unitarios de la proyección de estilo INDEPENDIENTE de los textos extra
 * tipo "hook" (`lib/estilo.ts`): `estiloTextoExtraDesdeAjustes` y
 * `ajustesTextoExtra`.
 *
 * Tarea 8.4 de la spec `edicion-avanzada-shorts`. A diferencia de la proyección
 * de subtítulos (`AjustesSubtitulos` snake_case ↔ `Estilo` camelCase), aquí
 * ambas representaciones ya están en camelCase y comparten forma
 * (`EstiloTextoExtra`), por lo que la proyección es un copiado PURO campo a
 * campo. Estas pruebas verifican, para los 8 campos de estilo (fuente, tamano,
 * color, colorBorde, grosorBorde, negrita, posVerticalPct, posHorizontalPct):
 *
 *   - Round-trip (hermana de P4): `estiloTextoExtraDesdeAjustes ∘ ajustesTextoExtra`
 *     recupera exactamente el estilo aplicado.
 *   - Casos límite de rango del motor (tamano 12/200, grosorBorde 0/20,
 *     posiciones 0/100): la proyección NO recorta ni altera valores válidos.
 *   - Inmutabilidad: ninguna de las funciones muta sus entradas.
 *
 * La validación fuerte de rangos vive en el backend (Req 15.5); aquí solo se
 * comprueba que la proyección respeta los valores válidos sin tocarlos.
 *
 * Validates: Requirements 15.5
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  ajustesTextoExtra,
  estiloTextoExtraDesdeAjustes,
} from '../estilo';
import type { EstiloTextoExtra as EstiloTextoExtraBackend } from '../types';
import type { EstiloTextoExtra as EstiloTextoExtraComposicion } from '@/components/remotion/types';

/** Estilo base (representa unos ajustes vigentes previos). */
const BASE: EstiloTextoExtraBackend = {
  fuente: 'Poppins',
  tamano: 72,
  color: '#FFFFFF',
  colorBorde: '#000000',
  grosorBorde: 5,
  negrita: true,
  posVerticalPct: 20,
  posHorizontalPct: 50,
};

/** Estilo de la composición, distinto de BASE en los 8 campos. */
const ESTILO: EstiloTextoExtraComposicion = {
  fuente: 'Inter',
  tamano: 96,
  color: '#112233',
  colorBorde: '#445566',
  grosorBorde: 8,
  negrita: false,
  posVerticalPct: 40,
  posHorizontalPct: 70,
};

describe('estiloTextoExtraDesdeAjustes', () => {
  it('proyecta los 8 campos de estilo (copia pura camelCase → camelCase)', () => {
    expect(estiloTextoExtraDesdeAjustes(BASE)).toEqual({
      fuente: 'Poppins',
      tamano: 72,
      color: '#FFFFFF',
      colorBorde: '#000000',
      grosorBorde: 5,
      negrita: true,
      posVerticalPct: 20,
      posHorizontalPct: 50,
    });
  });

  it('no muta la entrada', () => {
    const copia = structuredClone(BASE);
    estiloTextoExtraDesdeAjustes(BASE);
    expect(BASE).toEqual(copia);
  });
});

describe('ajustesTextoExtra', () => {
  it('aplica los 8 campos de estilo sobre una copia', () => {
    expect(ajustesTextoExtra(BASE, ESTILO)).toEqual({
      fuente: 'Inter',
      tamano: 96,
      color: '#112233',
      colorBorde: '#445566',
      grosorBorde: 8,
      negrita: false,
      posVerticalPct: 40,
      posHorizontalPct: 70,
    });
  });

  it('no muta la base ni el estilo de entrada', () => {
    const copiaBase = structuredClone(BASE);
    const copiaEstilo = structuredClone(ESTILO);
    ajustesTextoExtra(BASE, ESTILO);
    expect(BASE).toEqual(copiaBase);
    expect(ESTILO).toEqual(copiaEstilo);
  });

  it('devuelve un objeto nuevo (no la misma referencia que la base)', () => {
    const resultado = ajustesTextoExtra(BASE, ESTILO);
    expect(resultado).not.toBe(BASE);
  });
});

describe('round-trip de estilo de texto extra (hermana de P4)', () => {
  it('estiloTextoExtraDesdeAjustes ∘ ajustesTextoExtra recupera el estilo', () => {
    const round = estiloTextoExtraDesdeAjustes(ajustesTextoExtra(BASE, ESTILO));
    expect(round).toEqual(ESTILO);
  });

  it('recupera cada uno de los 8 campos de estilo', () => {
    const round = estiloTextoExtraDesdeAjustes(ajustesTextoExtra(BASE, ESTILO));
    // Comprobación explícita campo a campo para dejar constancia de los 8.
    expect(round.fuente).toBe(ESTILO.fuente);
    expect(round.tamano).toBe(ESTILO.tamano);
    expect(round.color).toBe(ESTILO.color);
    expect(round.colorBorde).toBe(ESTILO.colorBorde);
    expect(round.grosorBorde).toBe(ESTILO.grosorBorde);
    expect(round.negrita).toBe(ESTILO.negrita);
    expect(round.posVerticalPct).toBe(ESTILO.posVerticalPct);
    expect(round.posHorizontalPct).toBe(ESTILO.posHorizontalPct);
  });
});

describe('casos límite de rango: la proyección no recorta ni altera valores válidos', () => {
  // Valores extremos válidos del motor (Req 15.5): la proyección es copia pura,
  // por lo que deben conservarse EXACTAMENTE en ambos sentidos.
  const casosLimite: EstiloTextoExtraComposicion[] = [
    // Mínimos de cada rango.
    {
      fuente: 'Arial',
      tamano: 12,
      color: '#000000',
      colorBorde: '#FFFFFF',
      grosorBorde: 0,
      negrita: false,
      posVerticalPct: 0,
      posHorizontalPct: 0,
    },
    // Máximos de cada rango.
    {
      fuente: 'Roboto',
      tamano: 200,
      color: '#ABCDEF',
      colorBorde: '#123456',
      grosorBorde: 20,
      negrita: true,
      posVerticalPct: 100,
      posHorizontalPct: 100,
    },
    // Mezcla de extremos (mínimo vertical, máximo horizontal, etc.).
    {
      fuente: 'Poppins',
      tamano: 12,
      color: '#FF0000',
      colorBorde: '#00FF00',
      grosorBorde: 20,
      negrita: true,
      posVerticalPct: 100,
      posHorizontalPct: 0,
    },
  ];

  it.each(casosLimite)(
    'conserva los valores válidos extremos en el round-trip (%o)',
    (estilo) => {
      const round = estiloTextoExtraDesdeAjustes(ajustesTextoExtra(BASE, estilo));
      expect(round).toEqual(estilo);
    },
  );

  it('ajustesTextoExtra copia los extremos sin recortarlos', () => {
    for (const estilo of casosLimite) {
      const aplicado = ajustesTextoExtra(BASE, estilo);
      expect(aplicado.tamano).toBe(estilo.tamano);
      expect(aplicado.grosorBorde).toBe(estilo.grosorBorde);
      expect(aplicado.posVerticalPct).toBe(estilo.posVerticalPct);
      expect(aplicado.posHorizontalPct).toBe(estilo.posHorizontalPct);
    }
  });
});

describe('round-trip exhaustivo con fast-check (refuerzo de los 8 campos)', () => {
  /** Color `#RRGGBB` en mayúsculas. */
  const arbColor = fc
    .integer({ min: 0, max: 0xffffff })
    .map((n) => `#${n.toString(16).padStart(6, '0').toUpperCase()}`);

  /** Estilo de texto extra arbitrario dentro de los rangos válidos del motor. */
  const arbEstiloTextoExtra: fc.Arbitrary<EstiloTextoExtraComposicion> = fc.record({
    fuente: fc.string(),
    tamano: fc.double({ min: 12, max: 200, noNaN: true, noDefaultInfinity: true }),
    color: arbColor,
    colorBorde: arbColor,
    grosorBorde: fc.double({ min: 0, max: 20, noNaN: true, noDefaultInfinity: true }),
    negrita: fc.boolean(),
    posVerticalPct: fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
    posHorizontalPct: fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
  });

  it('recupera el estilo para cualquier combinación válida (≥ 100 iteraciones)', () => {
    fc.assert(
      fc.property(arbEstiloTextoExtra, (estilo) => {
        const round = estiloTextoExtraDesdeAjustes(ajustesTextoExtra(BASE, estilo));
        expect(round).toEqual(estilo);
      }),
      { numRuns: 500 },
    );
  });
});
