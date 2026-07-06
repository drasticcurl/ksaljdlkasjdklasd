/**
 * Tests de la validación de archivos de clips (`lib/validation.ts`).
 *
 * Incluye el test property-based de la Propiedad 3 del diseño más algunos
 * ejemplos concretos que documentan casos límite.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  MAX_CLIP_SIZE_BYTES,
  MAX_CLIPS_PER_UPLOAD,
  SUPPORTED_VIDEO_EXTENSIONS,
  validarClips,
  validarSeleccion,
  extensionDe,
  type ArchivoValidable,
} from '../validation';

const MB = 1024 * 1024;

// ---------------------------------------------------------------------------
// Ejemplos concretos (unit)
// ---------------------------------------------------------------------------

describe('validarClips (ejemplos)', () => {
  it('acepta un mp4 dentro del límite de tamaño', () => {
    const { aceptados, rechazados } = validarClips([
      { name: 'toma1.mp4', size: 10 * MB },
    ]);
    expect(aceptados).toHaveLength(1);
    expect(rechazados).toHaveLength(0);
  });

  it('acepta extensiones soportadas sin distinguir mayúsculas', () => {
    const { aceptados } = validarClips([{ name: 'CLIP.MOV', size: 1 }]);
    expect(aceptados).toHaveLength(1);
  });

  it('rechaza formato no soportado con un motivo que identifica el archivo', () => {
    const { aceptados, rechazados } = validarClips([
      { name: 'documento.txt', size: 1 },
    ]);
    expect(aceptados).toHaveLength(0);
    expect(rechazados).toHaveLength(1);
    expect(rechazados[0].motivo).toBe('FORMATO_NO_SOPORTADO');
    expect(rechazados[0].mensaje).toContain('documento.txt');
  });

  it('rechaza archivos que exceden 500 MB', () => {
    const { rechazados } = validarClips([
      { name: 'grande.mp4', size: MAX_CLIP_SIZE_BYTES + 1 },
    ]);
    expect(rechazados).toHaveLength(1);
    expect(rechazados[0].motivo).toBe('TAMANO_EXCEDIDO');
    expect(rechazados[0].mensaje).toContain('grande.mp4');
  });

  it('acepta exactamente en el borde de 500 MB', () => {
    const { aceptados } = validarClips([
      { name: 'borde.mp4', size: MAX_CLIP_SIZE_BYTES },
    ]);
    expect(aceptados).toHaveLength(1);
  });

  it('trata un nombre sin extensión como formato no soportado', () => {
    expect(extensionDe('sinpunto')).toBe('');
    const { rechazados } = validarClips([{ name: 'sinpunto', size: 1 }]);
    expect(rechazados[0].motivo).toBe('FORMATO_NO_SOPORTADO');
  });
});

describe('validarSeleccion (límite de 50 — Req 1.5)', () => {
  it('rechaza la selección completa cuando hay más de 50 archivos', () => {
    const files: ArchivoValidable[] = Array.from(
      { length: MAX_CLIPS_PER_UPLOAD + 1 },
      (_, i) => ({ name: `c${i}.mp4`, size: 1 }),
    );
    const r = validarSeleccion(files);
    expect(r.limiteExcedido).toBe(true);
    expect(r.aceptados).toHaveLength(0);
    expect(r.mensajeLimite).toContain(String(MAX_CLIPS_PER_UPLOAD));
  });

  it('valida por archivo cuando hay 50 o menos', () => {
    const files: ArchivoValidable[] = Array.from(
      { length: MAX_CLIPS_PER_UPLOAD },
      (_, i) => ({ name: `c${i}.mp4`, size: 1 }),
    );
    const r = validarSeleccion(files);
    expect(r.limiteExcedido).toBe(false);
    expect(r.aceptados).toHaveLength(MAX_CLIPS_PER_UPLOAD);
  });
});

// ---------------------------------------------------------------------------
// Property 3 (property-based, fast-check)
// ---------------------------------------------------------------------------

/**
 * Feature: vertical-shorts-editor, Property 3: La validación de archivos
 * conserva exactamente los válidos. Para cualquier selección mixta de archivos,
 * el conjunto de archivos aceptados por la Interfaz es exactamente el
 * subconjunto de archivos con formato soportado y tamaño <= 500 MB, y cada
 * archivo rechazado tiene asociado un motivo que lo identifica.
 *
 * Validates: Requirements 1.4
 */

/** Especificación generada de un archivo, con su validez conocida por construcción. */
interface EspecArchivo extends ArchivoValidable {
  /** Validez esperada (oráculo independiente de la implementación). */
  valido: boolean;
}

/** Base del nombre sin puntos, para que la extensión sea determinista. */
const baseArb = fc.stringMatching(/^[A-Za-z0-9_-]{1,20}$/);

/** Extensión soportada, posiblemente en mayúsculas (case-insensitivity). */
const extSoportadaArb = fc
  .constantFrom(...SUPPORTED_VIDEO_EXTENSIONS)
  .chain((e) => fc.constantFrom(e, e.toUpperCase()));

/** Extensión NO soportada (incluye "" = sin extensión). */
const extNoSoportadaArb = fc.constantFrom(
  '.txt',
  '.mp3',
  '.exe',
  '.png',
  '.pdf',
  '.zip',
  '.mov2',
  '',
);

const tamanoOkArb = fc.integer({ min: 0, max: MAX_CLIP_SIZE_BYTES });
const tamanoGrandeArb = fc.integer({
  min: MAX_CLIP_SIZE_BYTES + 1,
  max: MAX_CLIP_SIZE_BYTES + 100 * MB,
});

/** Archivo válido: formato soportado + tamaño dentro del límite. */
const especValidoArb: fc.Arbitrary<EspecArchivo> = fc
  .record({ base: baseArb, ext: extSoportadaArb, size: tamanoOkArb })
  .map(({ base, ext, size }) => ({ name: `${base}${ext}`, size, valido: true }));

/** Archivo inválido por formato, por tamaño, o por ambos. */
const especInvalidoArb: fc.Arbitrary<EspecArchivo> = fc.oneof(
  // Formato no soportado (tamaño ok).
  fc
    .record({ base: baseArb, ext: extNoSoportadaArb, size: tamanoOkArb })
    .map(({ base, ext, size }) => ({ name: `${base}${ext}`, size, valido: false })),
  // Tamaño excedido (formato soportado).
  fc
    .record({ base: baseArb, ext: extSoportadaArb, size: tamanoGrandeArb })
    .map(({ base, ext, size }) => ({ name: `${base}${ext}`, size, valido: false })),
  // Ambos inválidos.
  fc
    .record({ base: baseArb, ext: extNoSoportadaArb, size: tamanoGrandeArb })
    .map(({ base, ext, size }) => ({ name: `${base}${ext}`, size, valido: false })),
);

const especArb = fc.oneof(especValidoArb, especInvalidoArb);

describe('Propiedad 3: la validación conserva exactamente los válidos', () => {
  it('acepta exactamente el subconjunto válido y motiva cada rechazo', () => {
    fc.assert(
      fc.property(fc.array(especArb, { maxLength: 50 }), (specs) => {
        const files: ArchivoValidable[] = specs.map((s) => ({
          name: s.name,
          size: s.size,
        }));

        const { aceptados, rechazados } = validarClips(files);

        // Partición: aceptados + rechazados == entrada (sin pérdidas ni duplicados).
        expect(aceptados.length + rechazados.length).toBe(files.length);

        // Los aceptados son EXACTAMENTE el subconjunto válido, en orden y por
        // referencia.
        const esperadosAceptados = files.filter((_, i) => specs[i].valido);
        expect(aceptados).toEqual(esperadosAceptados);

        // Cada aceptado corresponde a una especificación válida.
        aceptados.forEach((f) => {
          const idx = files.indexOf(f);
          expect(specs[idx].valido).toBe(true);
        });

        // Cada rechazado corresponde a una especificación inválida y su motivo
        // identifica el archivo por nombre (Req 1.4).
        rechazados.forEach((r) => {
          const idx = files.indexOf(r.archivo);
          expect(specs[idx].valido).toBe(false);
          expect(r.mensaje).toContain(r.archivo.name);
          expect(['FORMATO_NO_SOPORTADO', 'TAMANO_EXCEDIDO']).toContain(
            r.motivo,
          );
        });
      }),
      { numRuns: 200 },
    );
  });
});
