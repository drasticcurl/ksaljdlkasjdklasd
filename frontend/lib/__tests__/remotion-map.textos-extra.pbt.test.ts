/**
 * Prueba Property-Based (PBT) de la tarea 8.3:
 * "Coherencia del mapeo de `textosExtra` backend↔frontend" con `fast-check`.
 *
 * Cubre la Correctness Property del diseño (design.md → "P7 — Coherencia del
 * mapeo de `textosExtra` backend↔frontend"):
 *
 *   - P7: para todo `TextoExtra`, `textosExtraBackendARemotion` (TS) produce los
 *     MISMOS `inicioMs`/`finMs` (usando el mismo redondeo banker's
 *     `redondearMitadAPar`) y el mismo estilo camelCase que el backend
 *     `mapear_texto_extra_a_props` de `backend/app/engine/remotion.py`.
 *
 * **Validates: Requirements 10.2, 19.3**
 *
 * ---------------------------------------------------------------------------
 * ENFOQUE DEL ORÁCULO (comparación con el criterio del backend)
 * ---------------------------------------------------------------------------
 * Vitest no puede ejecutar Python, así que NO comparamos en vivo contra
 * `backend/app/engine/remotion.py`. Siguiendo el mismo patrón que
 * `coherencia-remotion.pbt.test.ts` (P1/P2), este archivo implementa un
 * **oráculo de referencia independiente**: una transcripción directa (y separada
 * de la implementación de producción) del criterio del backend.
 *
 * Diferencia clave con el mapeo de grupos: el `TextoExtra` del frontend YA está
 * expresado en milisegundos (`inicioMs`/`finMs`), mientras que el backend parte
 * de segundos (`inicio_s`/`fin_s`) y calcula `round(inicio_s * 1000)`. Por eso
 * el punto crítico a verificar es el **CRITERIO DE REDONDEO**: el backend usa
 * `round()` de Python (banker's rounding / *round-half-to-even*), y el frontend
 * debe reproducirlo con `redondearMitadAPar` para que ambos coincidan también en
 * los milisegundos fraccionarios, incluidos los empates exactos en `N + 0.5`.
 *
 * El oráculo reimplementa aquí (sin importar nada de `lib/remotion-map.ts`) el
 * redondeo *round-half-to-even*, la garantía `finMs >= inicioMs` y la copia 1:1
 * del estilo a camelCase (réplica de `_estilo_texto_extra_a_props` del backend).
 * La PBT comprueba que la función de producción y el oráculo coinciden sobre
 * cientos de entradas aleatorias (incluidos empates `.5` y tiempos invertidos).
 * Se complementa con **vectores dorados** de los empates exactos `.5 ms`, cuyos
 * valores corresponden a la salida documentada de `round()` de Python.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { textosExtraBackendARemotion } from '../remotion-map';
import type { EstiloTextoExtra, TextoExtra } from '../types';
import type {
  EstiloTextoExtra as EstiloTextoExtraProps,
  TextoExtraProps,
} from '@/components/remotion/types';

// Número de casos aleatorios por propiedad. El Requisito 19.6 exige >= 100
// iteraciones para toda PBT; se elige 500 para una cobertura amplia manteniendo
// la suite rápida y determinista (mismo criterio que el resto de PBT del repo).
const NUM_RUNS = 500;

// ===========================================================================
// ORÁCULO DE REFERENCIA (transcripción independiente de backend/.../remotion.py)
// ===========================================================================

/**
 * Redondeo *round-half-to-even* (banker's rounding), equivalente a `round()` de
 * Python sobre el mismo valor `double`. Transcripción independiente del criterio
 * del backend (`round(inicio_s * 1000)`), sin depender de `Math.round` (que en
 * JS redondea la mitad hacia +∞ y divergiría del backend en los empates `.5`).
 */
function oracleRoundHalfEven(valor: number): number {
  const suelo = Math.floor(valor);
  const fraccion = valor - suelo;
  if (fraccion < 0.5) return suelo;
  if (fraccion > 0.5) return suelo + 1;
  // Empate exacto (.5): hacia el entero par.
  return suelo % 2 === 0 ? suelo : suelo + 1;
}

/**
 * Réplica del criterio de `_ms_desde_segundos` del backend aplicado a valores
 * que YA vienen en milisegundos: redondea ambos extremos con banker's rounding
 * y, si el redondeo invirtiera el intervalo (`finMs < inicioMs`), fija
 * `finMs = inicioMs`.
 */
function oracleRedondearIntervaloMs(
  inicioMs: number,
  finMs: number,
): [number, number] {
  const inicio = oracleRoundHalfEven(inicioMs);
  let fin = oracleRoundHalfEven(finMs);
  if (fin < inicio) fin = inicio;
  return [inicio, fin];
}

/**
 * Réplica de `_estilo_texto_extra_a_props` del backend: copia 1:1 del estilo a
 * camelCase (ambos lados usan exactamente los mismos campos camelCase, así que
 * es una copia explícita campo a campo, en el mismo orden que el backend).
 */
function oracleEstilo(e: EstiloTextoExtra): EstiloTextoExtraProps {
  return {
    fuente: e.fuente,
    tamano: e.tamano,
    color: e.color,
    colorBorde: e.colorBorde,
    grosorBorde: e.grosorBorde,
    negrita: e.negrita,
    posVerticalPct: e.posVerticalPct,
    posHorizontalPct: e.posHorizontalPct,
  };
}

/** Réplica de `mapear_texto_extra_a_props` del backend (contrato `TextoExtraProps`). */
function oracleMapearTextoExtra(t: TextoExtra): TextoExtraProps {
  const [inicioMs, finMs] = oracleRedondearIntervaloMs(t.inicioMs, t.finMs);
  return {
    texto: t.texto,
    inicioMs,
    finMs,
    estilo: oracleEstilo(t.estilo),
  };
}

// ===========================================================================
// GENERADORES (arbitraries)
// ===========================================================================

/** Componente de color `#RRGGBB` (formato del contrato de estilo). */
const arbColor = fc
  .integer({ min: 0, max: 0xffffff })
  .map((n) => `#${n.toString(16).padStart(6, '0').toUpperCase()}`);

/**
 * Milisegundo (in/out) del texto extra: mezcla intencionada de
 *   - dobles arbitrarios (fraccionarios y con valores negativos, para producir
 *     de forma natural intervalos invertidos al combinar dos extremos),
 *   - empates EXACTOS `N + 0.5` (donde `Math.round` de JS divergiría del
 *     backend), y
 *   - enteros exactos (sin fracción).
 * Este es el punto crítico de la Propiedad P7: el redondeo debe coincidir con
 * `round()` de Python también en los empates.
 */
const arbMs = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.double({
      min: -2000,
      max: 600_000,
      noNaN: true,
      noDefaultInfinity: true,
    }),
  },
  // Empates exactos en `N + 0.5` ms (N entero): la fracción es exactamente 0.5.
  { weight: 2, arbitrary: fc.integer({ min: -2000, max: 600_000 }).map((n) => n + 0.5) },
  // Milisegundos enteros (sin parte fraccionaria).
  { weight: 1, arbitrary: fc.integer({ min: -2000, max: 600_000 }) },
);

/** Estilo de texto extra con todos los campos dentro de sus rangos válidos. */
const arbEstiloTextoExtra: fc.Arbitrary<EstiloTextoExtra> = fc.record({
  fuente: fc.string(),
  tamano: fc.double({ min: 12, max: 200, noNaN: true, noDefaultInfinity: true }),
  color: arbColor,
  colorBorde: arbColor,
  grosorBorde: fc.double({ min: 0, max: 20, noNaN: true, noDefaultInfinity: true }),
  negrita: fc.boolean(),
  posVerticalPct: fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
  posHorizontalPct: fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
});

/**
 * `TextoExtra` del frontend: texto arbitrario, `inicioMs`/`finMs` independientes
 * (puede quedar `finMs < inicioMs` para ejercitar la garantía de orden) con
 * fraccionarios y empates `.5`, y estilo con rangos válidos.
 */
const arbTextoExtra: fc.Arbitrary<TextoExtra> = fc.record({
  texto: fc.string(),
  inicioMs: arbMs,
  finMs: arbMs,
  estilo: arbEstiloTextoExtra,
});

// ===========================================================================
// P7 — coherencia del mapeo textosExtra backend↔frontend
// ===========================================================================

describe('P7: textosExtraBackendARemotion coincide con el criterio del backend', () => {
  it('produce los mismos inicioMs/finMs y estilo camelCase que el oráculo (textos aleatorios)', () => {
    fc.assert(
      fc.property(arbTextoExtra, (t) => {
        const [r] = textosExtraBackendARemotion([t]);
        expect(r).toEqual(oracleMapearTextoExtra(t));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('coincide con el oráculo sobre listas (hasta 2 textos, límite de la etapa final)', () => {
    fc.assert(
      fc.property(fc.array(arbTextoExtra, { maxLength: 2 }), (textos) => {
        expect(textosExtraBackendARemotion(textos)).toEqual(
          textos.map(oracleMapearTextoExtra),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('garantiza el orden finMs >= inicioMs tras el mapeo (invariante)', () => {
    fc.assert(
      fc.property(arbTextoExtra, (t) => {
        const [r] = textosExtraBackendARemotion([t]);
        expect(r.finMs).toBeGreaterThanOrEqual(r.inicioMs);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('conserva el texto y proyecta el estilo camelCase campo a campo (invariante)', () => {
    fc.assert(
      fc.property(arbTextoExtra, (t) => {
        const [r] = textosExtraBackendARemotion([t]);
        // El texto no se transforma.
        expect(r.texto).toBe(t.texto);
        // El estilo se proyecta 1:1 a camelCase (mismos campos y valores).
        expect(r.estilo).toEqual({
          fuente: t.estilo.fuente,
          tamano: t.estilo.tamano,
          color: t.estilo.color,
          colorBorde: t.estilo.colorBorde,
          grosorBorde: t.estilo.grosorBorde,
          negrita: t.estilo.negrita,
          posVerticalPct: t.estilo.posVerticalPct,
          posHorizontalPct: t.estilo.posHorizontalPct,
        });
        // El conjunto de claves del estilo es exactamente el contrato camelCase.
        expect(Object.keys(r.estilo).sort()).toEqual(
          [
            'color',
            'colorBorde',
            'fuente',
            'grosorBorde',
            'negrita',
            'posHorizontalPct',
            'posVerticalPct',
            'tamano',
          ],
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('vectores dorados: empates .5 ms redondean como Python (half-to-even)', () => {
    // `round()` de Python: round(0.5)=0, round(1.5)=2, round(2.5)=2, round(3.5)=4.
    // Con `Math.round` (half-up de JS) estos casos divergirían del backend.
    const casos: Array<[number, number]> = [
      [0.5, 0],
      [1.5, 2],
      [2.5, 2],
      [3.5, 4],
      [4.5, 4],
      [-0.5, 0], // -0.5 -> 0 (entero par más cercano)
      [-1.5, -2],
      [-2.5, -2],
    ];
    const estilo: EstiloTextoExtra = {
      fuente: 'Inter',
      tamano: 72,
      color: '#FFFFFF',
      colorBorde: '#000000',
      grosorBorde: 5,
      negrita: true,
      posVerticalPct: 50,
      posHorizontalPct: 50,
    };
    for (const [ms, esperado] of casos) {
      // Anclamos que el valor elegido cae en un empate exacto de ms.
      expect(ms - Math.floor(ms)).toBe(0.5);
      // Usamos inicioMs == finMs para aislar el criterio de redondeo del extremo.
      const [r] = textosExtraBackendARemotion([
        { texto: 'hook', inicioMs: ms, finMs: ms, estilo },
      ]);
      expect(r.inicioMs).toBe(esperado);
      expect(r.finMs).toBe(esperado);
    }
  });
});
