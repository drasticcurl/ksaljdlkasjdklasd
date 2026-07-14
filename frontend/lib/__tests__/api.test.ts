/**
 * Tests de la lógica pura del cliente HTTP (`lib/api.ts`).
 *
 * Cubren `buildUrl` y `urlDescarga`, que son funciones puras de composición de
 * URLs sin efectos de red. Se combinan ejemplos concretos con un test
 * property-based (fast-check) para verificar invariantes de la unión de rutas.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { buildUrl, elegirRender, urlDescarga } from '../api';

describe('buildUrl', () => {
  it('une base y ruta con una sola barra', () => {
    expect(buildUrl('/clips', 'http://localhost:8000')).toBe(
      'http://localhost:8000/clips',
    );
  });

  it('normaliza barras finales de la base y barras iniciales de la ruta', () => {
    expect(buildUrl('clips', 'http://localhost:8000/')).toBe(
      'http://localhost:8000/clips',
    );
    expect(buildUrl('/clips', 'http://localhost:8000///')).toBe(
      'http://localhost:8000/clips',
    );
  });

  it('property: nunca produce doble barra en la unión base+ruta', () => {
    const segmento = fc
      .stringMatching(/^[a-z0-9_-]+$/)
      .filter((s) => s.length > 0 && s.length < 20);
    fc.assert(
      fc.property(segmento, segmento, (base, ruta) => {
        const url = buildUrl(`/${ruta}`, `http://host/${base}/`);
        // La parte tras el esquema `http://` no debe contener `//`.
        const trasEsquema = url.slice('http://'.length);
        expect(trasEsquema.includes('//')).toBe(false);
        expect(url.endsWith(`/${ruta}`)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

describe('urlDescarga', () => {
  it('codifica el job id en la ruta de descarga', () => {
    expect(urlDescarga('job_abc', 'http://localhost:8000')).toBe(
      'http://localhost:8000/descargar/job_abc',
    );
  });
});


// ---------------------------------------------------------------------------
// elegirRender — confirmación del motor (spec previsualizacion-video-real-remotion)
// ---------------------------------------------------------------------------

describe('elegirRender', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('confirma el render de Remotion con POST /render/{id} y cuerpo { motor: "remotion" }', async () => {
    // Mock de fetch que devuelve una respuesta 202 válida del backend.
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ job_id: 'job_1', estado: 'en_ejecucion' }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const resultado = await elegirRender('job_1', 'remotion', {
      baseUrl: 'http://localhost:8000',
    });

    // Se llamó exactamente una vez con la URL y el método correctos.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('http://localhost:8000/render/job_1');
    expect(init.method).toBe('POST');

    // El cuerpo enviado es exactamente { motor: "remotion" }.
    expect(JSON.parse(init.body as string)).toEqual({ motor: 'remotion' });

    // Se devuelve la respuesta parseada del backend.
    expect(resultado).toEqual({ job_id: 'job_1', estado: 'en_ejecucion' });
  });
});
