/**
 * Tests de la lógica pura de reordenamiento (`lib/reorder.ts`).
 *
 * Incluye el test property-based de la Propiedad 4 del diseño más algunos
 * ejemplos concretos que documentan la semántica de movimiento e identidad.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  reordenar,
  reordenarPorIds,
  esMovimientoValido,
  indiceEnRango,
  type ConId,
} from '../reorder';

// ---------------------------------------------------------------------------
// Ejemplos concretos (unit)
// ---------------------------------------------------------------------------

describe('reordenar (ejemplos)', () => {
  it('mueve un elemento del inicio al medio', () => {
    expect(reordenar(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('mueve un elemento del final hacia adelante', () => {
    expect(reordenar(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('deja el elemento movido exactamente en la posición de destino', () => {
    const resultado = reordenar([10, 20, 30, 40, 50], 1, 3);
    expect(resultado[3]).toBe(20);
    expect(resultado).toEqual([10, 30, 40, 20, 50]);
  });

  it('es identidad cuando desde === hasta', () => {
    expect(reordenar(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
  });

  it('es identidad ante índices fuera de rango (cancelación)', () => {
    expect(reordenar(['a', 'b', 'c'], 0, 9)).toEqual(['a', 'b', 'c']);
    expect(reordenar(['a', 'b', 'c'], -1, 1)).toEqual(['a', 'b', 'c']);
  });

  it('no muta la lista de entrada', () => {
    const original = ['a', 'b', 'c'];
    const copiaOriginal = [...original];
    reordenar(original, 0, 2);
    expect(original).toEqual(copiaOriginal);
  });
});

describe('reordenarPorIds (ejemplos)', () => {
  const items: ConId[] = [{ id: 'x' }, { id: 'y' }, { id: 'z' }];

  it('reordena moviendo el activo a la posición del destino', () => {
    expect(reordenarPorIds(items, 'x', 'z')).toEqual([
      { id: 'y' },
      { id: 'z' },
      { id: 'x' },
    ]);
  });

  it('es identidad cuando se suelta fuera de un destino válido (over null)', () => {
    expect(reordenarPorIds(items, 'x', null)).toEqual(items);
    expect(reordenarPorIds(items, 'x', undefined)).toEqual(items);
  });

  it('es identidad cuando el destino es el propio elemento', () => {
    expect(reordenarPorIds(items, 'y', 'y')).toEqual(items);
  });

  it('es identidad ante ids desconocidos', () => {
    expect(reordenarPorIds(items, 'x', 'inexistente')).toEqual(items);
    expect(reordenarPorIds(items, 'inexistente', 'z')).toEqual(items);
  });
});

// ---------------------------------------------------------------------------
// Property 4 (property-based, fast-check)
// ---------------------------------------------------------------------------

/**
 * Feature: vertical-shorts-editor, Property 4: El reordenamiento produce la
 * permutación esperada y la cancelación es identidad.
 *
 * Para cualquier orden de clips y cualquier movimiento válido de la posición i
 * a la posición j, el orden resultante coloca ese elemento en j conservando el
 * multiconjunto de clips; y para cualquier arrastre cancelado o soltado fuera
 * del área válida, el orden resultante es idéntico al orden previo.
 *
 * Validates: Requisitos 2.2, 2.6
 */

/** Comparador numérico total para comparar multiconjuntos de enteros. */
const cmpNum = (a: number, b: number): number => a - b;

/** Genera una lista no vacía de enteros junto con dos índices válidos i, j. */
const movimientoValidoArb = fc
  .array(fc.integer(), { minLength: 1, maxLength: 40 })
  .chain((items) =>
    fc.record({
      items: fc.constant(items),
      desde: fc.integer({ min: 0, max: items.length - 1 }),
      hasta: fc.integer({ min: 0, max: items.length - 1 }),
    }),
  );

/**
 * Genera una lista de clips con `id` únicos (satisface `ConId`), simulando el
 * `Orden_de_Clips` de la Interfaz.
 */
const clipsArb = fc
  .uniqueArray(
    fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.trim().length > 0),
    { minLength: 1, maxLength: 25 },
  )
  .map((ids) => ids.map((id) => ({ id })));

describe('Propiedad 4: reordenamiento = permutación esperada; cancelación = identidad', () => {
  it('un movimiento válido coloca el elemento en el destino y conserva el multiconjunto (Req 2.2)', () => {
    fc.assert(
      fc.property(movimientoValidoArb, ({ items, desde, hasta }) => {
        const resultado = reordenar(items, desde, hasta);

        // Conserva la cardinalidad.
        expect(resultado).toHaveLength(items.length);

        // Conserva el multiconjunto (mismos elementos, con repeticiones).
        expect([...resultado].sort(cmpNum)).toEqual([...items].sort(cmpNum));

        // El elemento movido queda EXACTAMENTE en la posición de destino.
        expect(resultado[hasta]).toBe(items[desde]);

        // No muta la entrada.
        expect(resultado).not.toBe(items);

        // Cuando desde === hasta, el resultado es idéntico (identidad).
        if (desde === hasta) {
          expect(resultado).toEqual(items);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('un arrastre cancelado / soltado fuera del área válida es identidad (Req 2.6)', () => {
    fc.assert(
      fc.property(
        clipsArb,
        // Un índice arbitrario que puede caer fuera de rango (cancelación).
        fc.integer({ min: -5, max: 60 }),
        fc.integer({ min: -5, max: 60 }),
        (items, desde, hasta) => {
          const activo = items[0].id;

          // 1) Soltar fuera de un destino válido (over == null) ⇒ identidad.
          expect(reordenarPorIds(items, activo, null)).toEqual(items);
          expect(reordenarPorIds(items, activo, undefined)).toEqual(items);

          // 2) Destino con id desconocido ⇒ identidad.
          expect(reordenarPorIds(items, activo, '\u0000id-inexistente')).toEqual(
            items,
          );

          // 3) Soltar sobre el propio elemento ⇒ identidad.
          expect(reordenarPorIds(items, activo, activo)).toEqual(items);

          // 4) `reordenar` con índices posiblemente fuera de rango o iguales:
          //    si el movimiento NO es válido, el resultado es identidad.
          const resultado = reordenar(items, desde, hasta);
          if (!esMovimientoValido(items.length, desde, hasta)) {
            expect(resultado).toEqual(items);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('reordenarPorIds coincide con reordenar para movimientos válidos por id', () => {
    fc.assert(
      fc.property(
        clipsArb.chain((items) =>
          fc.record({
            items: fc.constant(items),
            i: fc.integer({ min: 0, max: items.length - 1 }),
            j: fc.integer({ min: 0, max: items.length - 1 }),
          }),
        ),
        ({ items, i, j }) => {
          const porIds = reordenarPorIds(items, items[i].id, items[j].id);
          const porIndices = reordenar(items, i, j);
          expect(porIds).toEqual(porIndices);
          // El elemento activo queda en la posición del destino.
          expect(porIds[j]).toEqual(items[i]);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('predicados auxiliares (unit)', () => {
  it('indiceEnRango valida enteros dentro de [0, longitud)', () => {
    expect(indiceEnRango(0, 3)).toBe(true);
    expect(indiceEnRango(2, 3)).toBe(true);
    expect(indiceEnRango(3, 3)).toBe(false);
    expect(indiceEnRango(-1, 3)).toBe(false);
    expect(indiceEnRango(1.5, 3)).toBe(false);
  });

  it('esMovimientoValido exige índices en rango y distintos', () => {
    expect(esMovimientoValido(3, 0, 2)).toBe(true);
    expect(esMovimientoValido(3, 1, 1)).toBe(false);
    expect(esMovimientoValido(3, 0, 5)).toBe(false);
  });
});
