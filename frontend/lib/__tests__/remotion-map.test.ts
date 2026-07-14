/**
 * Tests unitarios básicos del mapeo puro `grupoBackendARemotion`
 * (`lib/remotion-map.ts`).
 *
 * Cubren ejemplos concretos del criterio replicado del backend
 * (`mapear_grupo_a_props_grupo`): redondeo segundos→ms, garantía
 * `endMs >= startMs`, herencia de tiempos de palabra, `words = []` sin palabras
 * y no-mutación de la entrada. Las propiedades exhaustivas (PBT contra el
 * criterio del backend) corresponden a la tarea 2.4.
 */

import { describe, expect, it } from 'vitest';
import {
  calcularDurationInFrames,
  grupoBackendARemotion,
  gruposBackendARemotion,
  redondearMitadAPar,
} from '../remotion-map';
import type { GrupoSubtituloConPalabras } from '../types';

describe('redondearMitadAPar (banker\'s rounding, coherente con Python round)', () => {
  it('redondea los empates .5 hacia el entero par', () => {
    expect(redondearMitadAPar(0.5)).toBe(0);
    expect(redondearMitadAPar(1.5)).toBe(2);
    expect(redondearMitadAPar(2.5)).toBe(2);
    expect(redondearMitadAPar(3.5)).toBe(4);
  });

  it('redondea normalmente los no-empates', () => {
    expect(redondearMitadAPar(0.4)).toBe(0);
    expect(redondearMitadAPar(0.6)).toBe(1);
    expect(redondearMitadAPar(2.499)).toBe(2);
    expect(redondearMitadAPar(2.501)).toBe(3);
  });

  it('trata correctamente los valores negativos (hacia el par)', () => {
    expect(redondearMitadAPar(-0.5)).toBe(0);
    expect(redondearMitadAPar(-1.5)).toBe(-2);
    expect(redondearMitadAPar(-2.5)).toBe(-2);
  });
});

describe('grupoBackendARemotion (ejemplos)', () => {
  it('mapea un grupo con palabras (karaoke) a milisegundos', () => {
    const g: GrupoSubtituloConPalabras = {
      texto: 'hola mundo',
      inicio_s: 0,
      fin_s: 2,
      palabras: [
        { texto: 'hola', inicio_s: 0, fin_s: 1 },
        { texto: 'mundo', inicio_s: 1, fin_s: 2 },
      ],
    };
    expect(grupoBackendARemotion(g)).toEqual({
      text: 'hola mundo',
      startMs: 0,
      endMs: 2000,
      words: [
        { text: 'hola', startMs: 0, endMs: 1000 },
        { text: 'mundo', startMs: 1000, endMs: 2000 },
      ],
    });
  });

  it('devuelve words = [] cuando no hay palabras (null, ausente o vacío)', () => {
    const base = { texto: 'sin palabras', inicio_s: 0.5, fin_s: 1.2 };
    const esperado = { text: 'sin palabras', startMs: 500, endMs: 1200, words: [] };

    expect(grupoBackendARemotion({ ...base, palabras: null })).toEqual(esperado);
    expect(grupoBackendARemotion({ ...base })).toEqual(esperado);
    expect(grupoBackendARemotion({ ...base, palabras: [] })).toEqual(esperado);
  });

  it('hereda los tiempos del grupo cuando una palabra no los tiene', () => {
    const g: GrupoSubtituloConPalabras = {
      texto: 'a b',
      inicio_s: 1,
      fin_s: 3,
      palabras: [
        { texto: ' a ', inicio_s: null, fin_s: 2 },
        { texto: 'b', inicio_s: 2, fin_s: null },
      ],
    };
    expect(grupoBackendARemotion(g)).toEqual({
      text: 'a b',
      startMs: 1000,
      endMs: 3000,
      words: [
        { text: 'a', startMs: 1000, endMs: 2000 },
        { text: 'b', startMs: 2000, endMs: 3000 },
      ],
    });
  });

  it('garantiza endMs >= startMs con tiempos invertidos', () => {
    const g: GrupoSubtituloConPalabras = {
      texto: 'x',
      inicio_s: 2,
      fin_s: 1,
      palabras: [{ texto: 'x', inicio_s: 5, fin_s: 1 }],
    };
    const r = grupoBackendARemotion(g);
    expect(r.startMs).toBe(2000);
    expect(r.endMs).toBe(2000);
    expect(r.words[0]).toEqual({ text: 'x', startMs: 5000, endMs: 5000 });
  });

  it('no muta el grupo de entrada', () => {
    const g: GrupoSubtituloConPalabras = {
      texto: 'inmutable',
      inicio_s: 0,
      fin_s: 1,
      palabras: [{ texto: 'inmutable', inicio_s: 0, fin_s: 1 }],
    };
    const copia = structuredClone(g);
    grupoBackendARemotion(g);
    expect(g).toEqual(copia);
  });

  it('gruposBackendARemotion mapea una lista completa', () => {
    const grupos: GrupoSubtituloConPalabras[] = [
      { texto: 'uno', inicio_s: 0, fin_s: 1 },
      { texto: 'dos', inicio_s: 1, fin_s: 2, palabras: [{ texto: 'dos', inicio_s: 1, fin_s: 2 }] },
    ];
    expect(gruposBackendARemotion(grupos)).toEqual([
      { text: 'uno', startMs: 0, endMs: 1000, words: [] },
      { text: 'dos', startMs: 1000, endMs: 2000, words: [{ text: 'dos', startMs: 1000, endMs: 2000 }] },
    ]);
  });
});


describe('calcularDurationInFrames (coherente con _calcular_duration_in_frames)', () => {
  it('usa duracionS cuando es fiable (> 0) con ceil y mínimo 1', () => {
    // 2.0s * 30fps = 60 frames.
    expect(calcularDurationInFrames(2, 30, [])).toBe(60);
    // ceil: 1.01s * 30fps = 30.3 -> 31.
    expect(calcularDurationInFrames(1.01, 30, [])).toBe(31);
    // Redondeo hacia arriba también en fracciones pequeñas: 0.001s * 30 = 0.03 -> 1.
    expect(calcularDurationInFrames(0.001, 30, [])).toBe(1);
  });

  it('cae al mayor endMs de los grupos cuando duracionS no es fiable', () => {
    const grupos = [
      { text: 'a', startMs: 0, endMs: 1000, words: [] },
      { text: 'b', startMs: 1000, endMs: 2500, words: [] },
    ];
    // maxEndMs = 2500 -> 2.5s * 30 = 75 frames.
    expect(calcularDurationInFrames(0, 30, grupos)).toBe(75);
    expect(calcularDurationInFrames(-5, 30, grupos)).toBe(75);
    expect(calcularDurationInFrames(Number.NaN, 30, grupos)).toBe(75);
    expect(calcularDurationInFrames(Number.POSITIVE_INFINITY, 30, grupos)).toBe(75);
  });

  it('devuelve al menos 1 frame sin duración ni grupos', () => {
    expect(calcularDurationInFrames(0, 30, [])).toBe(1);
    expect(calcularDurationInFrames(0, 1, [])).toBe(1);
  });

  it('prefiere duracionS fiable aunque haya grupos con mayor fin', () => {
    const grupos = [{ text: 'a', startMs: 0, endMs: 9000, words: [] }];
    // duracionS fiable (1s) tiene prioridad: 1 * 30 = 30, no 270.
    expect(calcularDurationInFrames(1, 30, grupos)).toBe(30);
  });

  it('no muta la lista de grupos', () => {
    const grupos = [{ text: 'a', startMs: 0, endMs: 2000, words: [] }];
    const copia = structuredClone(grupos);
    calcularDurationInFrames(0, 30, grupos);
    expect(grupos).toEqual(copia);
  });
});
