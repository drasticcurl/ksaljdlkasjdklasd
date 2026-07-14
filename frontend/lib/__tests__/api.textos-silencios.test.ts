/**
 * Tests del cliente de API de la spec `edicion-avanzada-shorts` y de la
 * persistencia local de la clave de OpenAI (tarea 7.3).
 *
 * Cubren:
 *   - Persistencia en `localStorage`: `guardarApiKeyLocal`, `leerApiKeyLocal`,
 *     `olvidarApiKeyLocal` (guardar/leer/olvidar y robustez cuando
 *     `localStorage` no está disponible → sin `throw`).
 *   - Formato de las peticiones (mockeando `fetch`):
 *       · `obtenerSilencios`   → GET  /silencios/{id} + parseo de `SilenciosEdicion`.
 *       · `enviarSilencios`    → POST /silencios/{id} con `{ tramos: [{inicio_s, fin_s}] }`
 *         (en segundos, sin conversión de unidades).
 *       · `confirmarRenderFinal` → POST /render/{id} con `{ textos_extra: [...] }`
 *         convertido a snake_case + SEGUNDOS (ms → s) y SIN campo `motor`.
 *   - Manejo de errores homogéneo (`ApiError` con `code`/`status`) para 404/409/400.
 *
 * Requisitos: 12.1, 12.2, 12.3.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  confirmarRenderFinal,
  enviarSilencios,
  guardarApiKeyLocal,
  leerApiKeyLocal,
  obtenerSilencios,
  olvidarApiKeyLocal,
} from '../api';
import type { SilenciosEdicion, TextoExtra, TramoSilencio } from '../types';

// ---------------------------------------------------------------------------
// Utilidades comunes
// ---------------------------------------------------------------------------

/** Construye una `Response` JSON con el estado indicado. */
function respuestaJson(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Envoltorio de error homogéneo del backend `{ error: { code, message } }`. */
function respuestaError(code: string, status: number, message = 'error'): Response {
  return respuestaJson({ error: { code, message, details: null } }, status);
}

const BASE = 'http://localhost:8000';

// ---------------------------------------------------------------------------
// Persistencia local de la clave de OpenAI (Req 12.1, 12.2, 12.3)
// ---------------------------------------------------------------------------

describe('persistencia de la clave de OpenAI en localStorage', () => {
  beforeEach(() => {
    // jsdom provee `localStorage`; partimos siempre de un estado limpio.
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('guarda y lee la clave bajo la clave `openai_api_key` (Req 12.1, 12.2)', () => {
    guardarApiKeyLocal('sk-prueba-123');

    // Se persiste exactamente bajo la clave esperada del contrato.
    expect(localStorage.getItem('openai_api_key')).toBe('sk-prueba-123');
    // Y `leerApiKeyLocal` recupera el mismo valor.
    expect(leerApiKeyLocal()).toBe('sk-prueba-123');
  });

  it('devuelve cadena vacía cuando no hay clave guardada', () => {
    expect(leerApiKeyLocal()).toBe('');
  });

  it('olvida (borra) la clave guardada (Req 12.3)', () => {
    guardarApiKeyLocal('sk-a-borrar');
    expect(leerApiKeyLocal()).toBe('sk-a-borrar');

    olvidarApiKeyLocal();

    expect(localStorage.getItem('openai_api_key')).toBeNull();
    expect(leerApiKeyLocal()).toBe('');
  });

  it('sobrescribe la clave al guardar de nuevo', () => {
    guardarApiKeyLocal('sk-vieja');
    guardarApiKeyLocal('sk-nueva');
    expect(leerApiKeyLocal()).toBe('sk-nueva');
  });

  describe('robustez cuando localStorage no está disponible', () => {
    beforeEach(() => {
      // Simulamos un entorno (SSR / modo privado) donde toda operación de
      // `localStorage` lanza; los helpers deben tragarse el error sin romper.
      vi.stubGlobal('localStorage', {
        getItem: () => {
          throw new Error('localStorage no disponible');
        },
        setItem: () => {
          throw new Error('localStorage no disponible');
        },
        removeItem: () => {
          throw new Error('localStorage no disponible');
        },
        clear: () => {
          throw new Error('localStorage no disponible');
        },
      });
    });

    it('guardarApiKeyLocal no lanza', () => {
      expect(() => guardarApiKeyLocal('sk-x')).not.toThrow();
    });

    it('leerApiKeyLocal no lanza y devuelve cadena vacía', () => {
      expect(() => leerApiKeyLocal()).not.toThrow();
      expect(leerApiKeyLocal()).toBe('');
    });

    it('olvidarApiKeyLocal no lanza', () => {
      expect(() => olvidarApiKeyLocal()).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// GET /silencios/{id} — obtenerSilencios (Req 5.1)
// ---------------------------------------------------------------------------

describe('obtenerSilencios', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hace GET a /silencios/{id} y parsea SilenciosEdicion', async () => {
    const payload: SilenciosEdicion = {
      job_id: 'job_1',
      estado: 'esperando_edicion_silencios',
      editable: true,
      video_url: 'http://localhost:8000/workfile/job_1/unido.mp4',
      video_nombre: 'unido.mp4',
      duracion_s: 42.5,
      fps: 30,
      ancho: 1080,
      alto: 1920,
      tramos: [
        { inicio_s: 1.0, fin_s: 2.0 },
        { inicio_s: 10.0, fin_s: 12.5 },
      ],
    };
    const fetchMock = vi.fn(async () => respuestaJson(payload, 200));
    vi.stubGlobal('fetch', fetchMock);

    const resultado = await obtenerSilencios('job_1', { baseUrl: BASE });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:8000/silencios/job_1');
    expect((init.method ?? 'GET').toUpperCase()).toBe('GET');
    // Se devuelve el objeto parseado tal cual lo emite el backend.
    expect(resultado).toEqual(payload);
  });

  it('codifica el job id en la ruta', async () => {
    const fetchMock = vi.fn(async () =>
      respuestaJson({ job_id: 'a/b', tramos: [] } as unknown, 200),
    );
    vi.stubGlobal('fetch', fetchMock);

    await obtenerSilencios('a/b', { baseUrl: BASE });

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe('http://localhost:8000/silencios/a%2Fb');
  });

  it('lanza ApiError con code/status al recibir 404 JOB_NOT_FOUND', async () => {
    const fetchMock = vi.fn(async () => respuestaError('JOB_NOT_FOUND', 404));
    vi.stubGlobal('fetch', fetchMock);

    await expect(obtenerSilencios('inexistente', { baseUrl: BASE })).rejects.toMatchObject(
      { name: 'ApiError', code: 'JOB_NOT_FOUND', status: 404 },
    );
    await expect(
      obtenerSilencios('inexistente', { baseUrl: BASE }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

// ---------------------------------------------------------------------------
// POST /silencios/{id} — enviarSilencios (Req 5.2, 5.3, 5.4)
// ---------------------------------------------------------------------------

describe('enviarSilencios', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hace POST a /silencios/{id} con { tramos } en segundos y sin conversión', async () => {
    const fetchMock = vi.fn(async () =>
      respuestaJson({ job_id: 'job_1', estado: 'en_ejecucion' }, 202),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tramos: TramoSilencio[] = [
      { inicio_s: 1.5, fin_s: 2.25 },
      { inicio_s: 10, fin_s: 12.75 },
    ];
    const resultado = await enviarSilencios('job_1', tramos, { baseUrl: BASE });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:8000/silencios/job_1');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );

    // El cuerpo son los tramos en SEGUNDOS, idénticos a la entrada (sin conversión).
    expect(JSON.parse(init.body as string)).toEqual({
      tramos: [
        { inicio_s: 1.5, fin_s: 2.25 },
        { inicio_s: 10, fin_s: 12.75 },
      ],
    });

    expect(resultado).toEqual({ job_id: 'job_1', estado: 'en_ejecucion' });
  });

  it('proyecta solo inicio_s/fin_s aunque el objeto traiga campos extra', async () => {
    const fetchMock = vi.fn(async () =>
      respuestaJson({ job_id: 'job_1', estado: 'en_ejecucion' }, 202),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tramos = [
      { inicio_s: 0, fin_s: 1, extra: 'ignorar' } as unknown as TramoSilencio,
    ];
    await enviarSilencios('job_1', tramos, { baseUrl: BASE });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      tramos: [{ inicio_s: 0, fin_s: 1 }],
    });
  });

  it('lanza ApiError 409 CONFLICT si el Job está fuera de la pausa de silencios', async () => {
    const fetchMock = vi.fn(async () => respuestaError('CONFLICT', 409));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      enviarSilencios('job_1', [{ inicio_s: 0, fin_s: 1 }], { baseUrl: BASE }),
    ).rejects.toMatchObject({ name: 'ApiError', code: 'CONFLICT', status: 409 });
  });

  it('lanza ApiError 400 INVALID_REQUEST con tramos inválidos', async () => {
    const fetchMock = vi.fn(async () => respuestaError('INVALID_REQUEST', 400));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      enviarSilencios('job_1', [{ inicio_s: 5, fin_s: 1 }], { baseUrl: BASE }),
    ).rejects.toMatchObject({ name: 'ApiError', code: 'INVALID_REQUEST', status: 400 });
  });
});

// ---------------------------------------------------------------------------
// POST /render/{id} — confirmarRenderFinal (Req 10.1, 11.x, 15.x)
// ---------------------------------------------------------------------------

describe('confirmarRenderFinal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Construye un `TextoExtra` de frontend (camelCase + milisegundos). */
  function textoExtra(overrides: Partial<TextoExtra> = {}): TextoExtra {
    return {
      texto: '¡Míralo!',
      inicioMs: 1500,
      finMs: 4000,
      estilo: {
        fuente: 'Arial',
        tamano: 72,
        color: '#FFFFFF',
        colorBorde: '#000000',
        grosorBorde: 5,
        negrita: true,
        posVerticalPct: 80,
        posHorizontalPct: 50,
      },
      ...overrides,
    };
  }

  it('hace POST a /render/{id} convirtiendo ms→s y camelCase→snake_case, sin `motor`', async () => {
    const fetchMock = vi.fn(async () =>
      respuestaJson({ job_id: 'job_1', estado: 'en_ejecucion' }, 202),
    );
    vi.stubGlobal('fetch', fetchMock);

    const resultado = await confirmarRenderFinal('job_1', [textoExtra()], {
      baseUrl: BASE,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:8000/render/job_1');
    expect(init.method).toBe('POST');

    const cuerpo = JSON.parse(init.body as string);

    // No se envía el campo `motor`: el backend usa Remotion por defecto (Req 11).
    expect(cuerpo).not.toHaveProperty('motor');
    expect(Object.keys(cuerpo)).toEqual(['textos_extra']);

    // Conversión ms→s exacta y renombrado de estilo a snake_case.
    expect(cuerpo.textos_extra).toEqual([
      {
        texto: '¡Míralo!',
        inicio_s: 1.5, // 1500 / 1000
        fin_s: 4.0, // 4000 / 1000
        estilo: {
          fuente: 'Arial',
          tamano: 72,
          color: '#FFFFFF',
          color_borde: '#000000', // colorBorde → color_borde
          grosor_borde: 5, // grosorBorde → grosor_borde
          negrita: true,
          pos_vertical_pct: 80, // posVerticalPct → pos_vertical_pct
          pos_horizontal_pct: 50, // posHorizontalPct → pos_horizontal_pct
        },
      },
    ]);

    expect(resultado).toEqual({ job_id: 'job_1', estado: 'en_ejecucion' });
  });

  it('envía lista vacía cuando no hay textos extra', async () => {
    const fetchMock = vi.fn(async () =>
      respuestaJson({ job_id: 'job_1', estado: 'en_ejecucion' }, 202),
    );
    vi.stubGlobal('fetch', fetchMock);

    await confirmarRenderFinal('job_1', [], { baseUrl: BASE });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ textos_extra: [] });
  });

  it('convierte cada uno de los (hasta 2) textos extra', async () => {
    const fetchMock = vi.fn(async () =>
      respuestaJson({ job_id: 'job_1', estado: 'en_ejecucion' }, 202),
    );
    vi.stubGlobal('fetch', fetchMock);

    await confirmarRenderFinal(
      'job_1',
      [
        textoExtra({ texto: 'Uno', inicioMs: 0, finMs: 1000 }),
        textoExtra({ texto: 'Dos', inicioMs: 2000, finMs: 3500 }),
      ],
      { baseUrl: BASE },
    );

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const cuerpo = JSON.parse(init.body as string);
    expect(cuerpo.textos_extra).toHaveLength(2);
    expect(cuerpo.textos_extra[0]).toMatchObject({ texto: 'Uno', inicio_s: 0, fin_s: 1 });
    expect(cuerpo.textos_extra[1]).toMatchObject({ texto: 'Dos', inicio_s: 2, fin_s: 3.5 });
  });

  it('lanza ApiError 409 CONFLICT si el Job no está en esperando_edicion_final', async () => {
    const fetchMock = vi.fn(async () => respuestaError('CONFLICT', 409));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      confirmarRenderFinal('job_1', [], { baseUrl: BASE }),
    ).rejects.toMatchObject({ name: 'ApiError', code: 'CONFLICT', status: 409 });
  });

  it('lanza ApiError 400 INVALID_REQUEST cuando el backend rechaza los textos', async () => {
    const fetchMock = vi.fn(async () => respuestaError('INVALID_REQUEST', 400));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      confirmarRenderFinal('job_1', [textoExtra()], { baseUrl: BASE }),
    ).rejects.toMatchObject({ name: 'ApiError', code: 'INVALID_REQUEST', status: 400 });
  });

  it('lanza ApiError 404 JOB_NOT_FOUND si el Job no existe', async () => {
    const fetchMock = vi.fn(async () => respuestaError('JOB_NOT_FOUND', 404));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      confirmarRenderFinal('inexistente', [], { baseUrl: BASE }),
    ).rejects.toMatchObject({ name: 'ApiError', code: 'JOB_NOT_FOUND', status: 404 });
  });
});
