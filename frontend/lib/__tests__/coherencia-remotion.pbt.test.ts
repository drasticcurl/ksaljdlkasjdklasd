/**
 * Pruebas Property-Based (PBT) de la tarea 2.4:
 * "Propiedades de coherencia y round-trip" con `fast-check`.
 *
 * Cubre las Correctness Properties del diseño (design.md → "Correctness
 * Properties" y "Testing Strategy"):
 *
 *   - P1 (coherencia de agrupamiento preview↔render): `grupoBackendARemotion`
 *     produce los mismos `startMs`/`endMs`/`words` que el criterio del backend
 *     (`mapear_grupo_a_props_grupo` / `_ms_desde_segundos` de
 *     `backend/app/engine/remotion.py`) para grupos aleatorios, INCLUYENDO
 *     tiempos degenerados/invertidos y palabras con timing faltante.
 *   - P2 (coherencia de duración): `calcularDurationInFrames` coincide con el
 *     criterio del backend (`_calcular_duration_in_frames`) para las mismas
 *     entradas.
 *   - P4 (round-trip de estilo): `estiloDesdeAjustes ∘ ajustesConEstilo` es
 *     idempotente sobre los campos de estilo.
 *
 * Validates: Requirements 3.2, 3.4, 3.5, 3.6, 5.2
 *
 * ---------------------------------------------------------------------------
 * ENFOQUE DEL ORACLE (comparación con el criterio del backend)
 * ---------------------------------------------------------------------------
 * Vitest no puede ejecutar Python, así que NO comparamos en vivo contra
 * `backend/app/engine/remotion.py`. En su lugar, este archivo implementa un
 * **oracle de referencia independiente**: una transcripción directa (y separada
 * de la implementación de producción) del criterio del backend, escrita a partir
 * del código fuente Python. El oracle no importa ninguna función de
 * `lib/remotion-map.ts`; reimplementa el redondeo *round-half-to-even* (banker's
 * rounding, como `round()` de Python), la garantía `endMs >= startMs`, la
 * herencia de tiempos por palabra y el criterio de `durationInFrames`.
 *
 * La PBT comprueba que la función de producción y el oracle coinciden sobre
 * miles de entradas aleatorias (incluidos casos degenerados). Complementamos el
 * oracle con **vectores dorados** de los empates exactos `.5 ms`, cuyos valores
 * corresponden a la salida documentada de `round()` de Python
 * (round-half-to-even), para anclar la coherencia en los casos frontera donde
 * `Math.round` (half-up de JS) divergiría del backend.
 *
 * Además de la igualdad con el oracle, P1 verifica invariantes estructurales de
 * valor propio (independientes del oracle): `endMs >= startMs` a nivel de grupo
 * y de palabra, `words = []` sin palabras, y conservación del texto del grupo.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  calcularDurationInFrames,
  grupoBackendARemotion,
  gruposBackendARemotion,
} from '../remotion-map';
import { ajustesConEstilo, estiloDesdeAjustes } from '../estilo';
import { AJUSTES_POR_DEFECTO } from '../defaults';
import type { GrupoSubtituloConPalabras, PalabraSubtitulo } from '../types';
import type { Estilo, Grupo } from '@/components/remotion/types';

// Número de casos aleatorios por propiedad (cobertura amplia manteniendo la
// suite rápida y determinista).
const NUM_RUNS = 1000;

// ===========================================================================
// ORACLE DE REFERENCIA (transcripción independiente de backend/.../remotion.py)
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
  // Empate exacto: hacia el entero par.
  return suelo % 2 === 0 ? suelo : suelo + 1;
}

/** Réplica de `_ms_desde_segundos` del backend (redondeo + `endMs >= startMs`). */
function oracleMsDesdeSegundos(inicioS: number, finS: number): [number, number] {
  const startMs = oracleRoundHalfEven(inicioS * 1000);
  let endMs = oracleRoundHalfEven(finS * 1000);
  if (endMs < startMs) endMs = startMs;
  return [startMs, endMs];
}

/** Réplica de `mapear_grupo_a_props_grupo` del backend (contrato `Grupo`). */
function oracleMapearGrupo(g: GrupoSubtituloConPalabras): Grupo {
  const [inicioMs, finMs] = oracleMsDesdeSegundos(g.inicio_s, g.fin_s);
  const words: Grupo['words'] = [];
  // En Python `if grupo.palabras:` es falso para `None` y para la lista vacía.
  if (g.palabras && g.palabras.length > 0) {
    for (const palabra of g.palabras) {
      const inicio =
        palabra.inicio_s !== null && palabra.inicio_s !== undefined
          ? palabra.inicio_s
          : g.inicio_s;
      const fin =
        palabra.fin_s !== null && palabra.fin_s !== undefined
          ? palabra.fin_s
          : g.fin_s;
      const [pInicio, pFin] = oracleMsDesdeSegundos(inicio, fin);
      words.push({ text: palabra.texto.trim(), startMs: pInicio, endMs: pFin });
    }
  }
  return { text: g.texto, startMs: inicioMs, endMs: finMs, words };
}

/** Réplica de `_calcular_duration_in_frames` para el dominio del frontend (ms). */
function oracleDurationInFrames(
  duracionS: number,
  fps: number,
  grupos: readonly Grupo[],
): number {
  const fiable = Number.isFinite(duracionS) && duracionS > 0;
  let duracionSegundos: number;
  if (fiable) {
    duracionSegundos = duracionS;
  } else {
    // Fallback: mayor `endMs` (ms) de los grupos, en segundos (÷1000), igual que
    // el `max(fin_s, default=0.0)` del backend proyectado al contrato de ms.
    let maxEndMs = 0;
    for (const g of grupos) {
      if (g.endMs > maxEndMs) maxEndMs = g.endMs;
    }
    duracionSegundos = maxEndMs / 1000;
  }
  return Math.max(1, Math.ceil(duracionSegundos * fps));
}

// ===========================================================================
// GENERADORES (arbitraries)
// ===========================================================================

/**
 * Tiempo en segundos: finito, con rango que incluye negativos (para producir
 * intervalos invertidos/degenerados de forma natural al combinar dos tiempos
 * independientes) y valores realistas de transcripción.
 */
const tiempoS = fc.double({
  min: -5,
  max: 600,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Palabra con `inicio_s`/`fin_s` a veces `null` (timing faltante). */
const arbPalabra: fc.Arbitrary<PalabraSubtitulo> = fc.record({
  texto: fc.string(),
  inicio_s: fc.option(tiempoS, { nil: null }),
  fin_s: fc.option(tiempoS, { nil: null }),
});

/**
 * Grupo del backend: texto arbitrario, tiempos independientes (puede quedar
 * `fin_s < inicio_s`) y `palabras` que puede ser `null`, ausente, lista vacía o
 * lista no vacía con palabras de timing parcial.
 */
const arbGrupo: fc.Arbitrary<GrupoSubtituloConPalabras> = fc
  .record(
    {
      texto: fc.string(),
      inicio_s: tiempoS,
      fin_s: tiempoS,
      palabras: fc.oneof(
        fc.constant<PalabraSubtitulo[] | null | undefined>(null),
        fc.constant<PalabraSubtitulo[] | null | undefined>(undefined),
        fc.array(arbPalabra, { maxLength: 8 }),
      ),
    },
    { requiredKeys: ['texto', 'inicio_s', 'fin_s'] },
  );

/** Grupo ya mapeado al contrato de Remotion (para P2), con `endMs` en ms. */
const arbGrupoRemotion: fc.Arbitrary<Grupo> = fc.record({
  text: fc.string(),
  startMs: fc.nat({ max: 600_000 }),
  endMs: fc.nat({ max: 600_000 }),
  words: fc.constant([]),
});

/** Componente de color `#RRGGBB` (no interviene en la proyección, pero es realista). */
const arbColor = fc
  .integer({ min: 0, max: 0xffffff })
  .map((n) => `#${n.toString(16).padStart(6, '0').toUpperCase()}`);

/** Estilo visual arbitrario y válido para el round-trip P4. */
const arbEstilo: fc.Arbitrary<Estilo> = fc.record({
  fuente: fc.string(),
  tamano: fc.double({ min: 12, max: 200, noNaN: true, noDefaultInfinity: true }),
  color: arbColor,
  colorResaltado: arbColor,
  posVerticalPct: fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
  animEntradaMs: fc.double({ min: 100, max: 2000, noNaN: true, noDefaultInfinity: true }),
  colorBorde: arbColor,
  grosorBorde: fc.double({ min: 0, max: 20, noNaN: true, noDefaultInfinity: true }),
  negrita: fc.boolean(),
});

// ===========================================================================
// P1 — coherencia de agrupamiento preview↔render
// ===========================================================================

describe('P1: grupoBackendARemotion coincide con el criterio del backend', () => {
  it('produce los mismos startMs/endMs/words que el oracle (grupos aleatorios)', () => {
    fc.assert(
      fc.property(arbGrupo, (g) => {
        expect(grupoBackendARemotion(g)).toEqual(oracleMapearGrupo(g));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('cumple invariantes estructurales (endMs>=startMs, words, texto)', () => {
    fc.assert(
      fc.property(arbGrupo, (g) => {
        const r = grupoBackendARemotion(g);
        // Texto del grupo inalterado (no se recorta a nivel de grupo).
        expect(r.text).toBe(g.texto);
        // Orden garantizado a nivel de grupo.
        expect(r.endMs).toBeGreaterThanOrEqual(r.startMs);
        const tienePalabras = !!(g.palabras && g.palabras.length > 0);
        if (!tienePalabras) {
          // Sin palabras => words vacío.
          expect(r.words).toEqual([]);
        } else {
          // Una entrada por palabra, con orden garantizado y texto recortado.
          expect(r.words).toHaveLength(g.palabras!.length);
          r.words.forEach((w, i) => {
            expect(w.endMs).toBeGreaterThanOrEqual(w.startMs);
            expect(w.text).toBe(g.palabras![i].texto.trim());
          });
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('gruposBackendARemotion coincide con el oracle sobre listas', () => {
    fc.assert(
      fc.property(fc.array(arbGrupo, { maxLength: 12 }), (grupos) => {
        expect(gruposBackendARemotion(grupos)).toEqual(
          grupos.map(oracleMapearGrupo),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('vectores dorados: empates .5 ms redondean como Python (half-to-even)', () => {
    // `round()` de Python: round(0.5)=0, round(1.5)=2, round(2.5)=2, round(3.5)=4.
    // Los segundos elegidos producen exactamente N.5 ms al multiplicar por 1000.
    const casos: Array<[number, number]> = [
      [0.0005, 0], // 0.5 ms -> 0
      [0.0015, 2], // 1.5 ms -> 2
      [0.0025, 2], // 2.5 ms -> 2
      [0.0035, 4], // 3.5 ms -> 4
    ];
    for (const [segundos, esperadoMs] of casos) {
      // Anclamos primero que el segundo elegido cae en un empate exacto de ms.
      const escalado = segundos * 1000;
      expect(escalado - Math.floor(escalado)).toBe(0.5);
      const r = grupoBackendARemotion({ texto: 'x', inicio_s: segundos, fin_s: segundos });
      expect(r.startMs).toBe(esperadoMs);
      expect(r.endMs).toBe(esperadoMs);
    }
  });
});

// ===========================================================================
// P2 — coherencia de duración
// ===========================================================================

describe('P2: calcularDurationInFrames coincide con el criterio del backend', () => {
  it('coincide con el oracle para duracionS fiable y no fiable', () => {
    const arbDuracion = fc.oneof(
      fc.double({ min: -5, max: 600, noNaN: true, noDefaultInfinity: true }),
      fc.constant(0),
      fc.constant(Number.NaN),
      fc.constant(Number.POSITIVE_INFINITY),
      fc.constant(Number.NEGATIVE_INFINITY),
    );
    fc.assert(
      fc.property(
        arbDuracion,
        fc.integer({ min: 1, max: 120 }),
        fc.array(arbGrupoRemotion, { maxLength: 12 }),
        (duracionS, fps, grupos) => {
          expect(calcularDurationInFrames(duracionS, fps, grupos)).toBe(
            oracleDurationInFrames(duracionS, fps, grupos),
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('resultado siempre >= 1 frame (invariante)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -5, max: 600, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: 1, max: 120 }),
        fc.array(arbGrupoRemotion, { maxLength: 12 }),
        (duracionS, fps, grupos) => {
          expect(calcularDurationInFrames(duracionS, fps, grupos)).toBeGreaterThanOrEqual(1);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ===========================================================================
// P4 — round-trip de estilo
// ===========================================================================

describe('P4: round-trip estiloDesdeAjustes ∘ ajustesConEstilo es idempotente', () => {
  it('recupera el estilo tras aplicarlo sobre los ajustes por defecto', () => {
    fc.assert(
      fc.property(arbEstilo, (estilo) => {
        const round = estiloDesdeAjustes(
          ajustesConEstilo(AJUSTES_POR_DEFECTO, estilo).subtitulos,
        );
        expect(round).toEqual(estilo);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('es idempotente con cualquier base de ajustes (no depende de la base)', () => {
    fc.assert(
      fc.property(arbEstilo, arbEstilo, (estiloBase, estilo) => {
        // Base arbitraria: partimos de unos ajustes con OTRO estilo aplicado.
        const base = ajustesConEstilo(AJUSTES_POR_DEFECTO, estiloBase);
        const round = estiloDesdeAjustes(ajustesConEstilo(base, estilo).subtitulos);
        expect(round).toEqual(estilo);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
