/**
 * Test de FLUJO DE INTEGRACIÓN — tarea 7.3.
 *
 * A diferencia de los tests de 7.1 (`PreviewRemotionReal`) y 7.2
 * (`EleccionRender`), que ejercitan cada componente de forma aislada (y en gran
 * parte inyectando funciones de `lib/api`), esta suite simula el RECORRIDO
 * COMPLETO del usuario a través de `EleccionRender` (que a su vez monta
 * `PreviewRemotionReal`) usando MOCKS DE RED: se sustituye el transporte HTTP
 * (`fetch`) de `lib/api` con `vi.stubGlobal('fetch', fetchMock)` en lugar de
 * inyectar funciones falsas. Así se verifica que el cableado real de
 * componentes + `lib/api` (`obtenerRender`, `obtenerConfiguracion`,
 * `guardarConfiguracion`, `elegirRender`) produce las peticiones esperadas.
 *
 * -------------------------------------------------------------------------
 * FLUJOS CUBIERTOS Y MAPEO CRITERIO → FLUJO
 *
 *   FLUJO 1 (Remotion con previsualización):
 *     `esperando_eleccion_render` → GET /render (respuesta ampliada) →
 *     toggle ON → preview montada (GET /configuracion + Player con vídeo real) →
 *     "Guardar estilo" (PUT /configuracion + mensaje de éxito, Req 5.3) →
 *     "Confirmar y renderizar" (POST /render {motor:'remotion'} → 202 →
 *     onRenderConfirmado → onElegido('remotion'), Req 6.3).
 *
 *   FLUJO 2 (ffmpeg sin previsualización):
 *     `esperando_eleccion_render` → GET /render → (sin activar el toggle) →
 *     "ffmpeg" (POST /render {motor:'ass'} → onElegido('ass')); NUNCA se
 *     consulta `/workfile` ni se monta el `<Player>` (Req 7.3).
 *
 *   AISLAMIENTO DEL FALLO DE VÍDEO (Req 9.4):
 *     Si el `<Player>` lanza al montarse (fallo de carga/reproducción del
 *     vídeo), el flujo de confirmar sigue operativo: se muestra el aviso de
 *     error del vídeo pero "Confirmar y renderizar" dispara igualmente el
 *     POST /render {motor:'remotion'} y onElegido('remotion').
 *
 *   - Req 5.3 → FLUJO 1: "Guardar estilo" hace PUT /configuracion y muestra
 *               el mensaje de éxito.
 *   - Req 6.3 → FLUJO 1: confirmar hace POST /render {remotion} y notifica la
 *               elección Remotion (onElegido('remotion')).
 *   - Req 7.3 → FLUJO 2: elegir ffmpeg no altera el flujo clásico ni monta el
 *               Player ni consulta /workfile.
 *   - Req 9.4 → el fallo del vídeo no afecta a la confirmación ni al editor.
 * -------------------------------------------------------------------------
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// Estado "hoisted" para controlar si el mock del Player debe LANZAR al
// renderizar (simula un fallo de carga/reproducción del vídeo, Req 9.4). Por
// defecto NO lanza (comportamiento normal de la previsualización).
const estadoPlayerMock = vi.hoisted(() => ({ lanzar: false }));

// Mock de `@remotion/player`: en jsdom el Player real no reproduce vídeo. Se
// sustituye por un stub que expone el `videoSrc` recibido en `inputProps`
// mediante un atributo `data-*`, para poder aseverar que el Player se monta con
// el vídeo REAL de fondo. Si `estadoPlayerMock.lanzar` está activo, el stub
// lanza al renderizar para ejercitar el Error Boundary de la preview (Req 9.4).
vi.mock('@remotion/player', () => ({
  Player: (props: { inputProps?: { videoSrc?: string } }) => {
    if (estadoPlayerMock.lanzar) {
      throw new Error('No se pudo cargar el vídeo de fondo (simulado)');
    }
    return (
      <div
        data-testid="player-mock"
        data-video-src={props.inputProps?.videoSrc ?? ''}
      />
    );
  },
}));

// Tras cada test se restablece el mock del Player a "no lanzar".
afterEach(() => {
  estadoPlayerMock.lanzar = false;
});

import EleccionRender from '../EleccionRender';
import { AJUSTES_POR_DEFECTO } from '@/lib/defaults';

const JOB_ID = 'job-123';
const VIDEO_URL = `http://127.0.0.1:8000/workfile/${JOB_ID}/cortado.mp4`;

/**
 * Respuesta ampliada de `GET /render/{id}` (contrato de la feature): grupos con
 * palabras, `video_url` no nulo y dimensiones/fps/duración del render.
 */
function respuestaRenderAmpliada() {
  return {
    job_id: JOB_ID,
    estado: 'esperando_eleccion_render',
    editable: false,
    motor_preferido: 'ass',
    grupos: [
      {
        texto: 'hola mundo',
        inicio_s: 0,
        fin_s: 2,
        palabras: [
          { texto: 'hola', inicio_s: 0, fin_s: 1 },
          { texto: 'mundo', inicio_s: 1, fin_s: 2 },
        ],
      },
    ],
    video_url: VIDEO_URL,
    video_nombre: 'cortado.mp4',
    fps: 30,
    ancho: 1080,
    alto: 1920,
    duracion_s: 2,
  };
}

/** Construye una `Response` mínima compatible con `parseJsonOrThrow`. */
function respuestaJson(cuerpo: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(cuerpo),
  } as unknown as Response;
}

/** Extrae el método HTTP (por defecto GET) de un `RequestInit`. */
function metodoDe(init?: RequestInit): string {
  return (init?.method ?? 'GET').toUpperCase();
}

/** Indica si alguna llamada a `fetch` apuntó a una URL con `/workfile`. */
function huboLlamadaAWorkfile(spy: ReturnType<typeof vi.fn>): boolean {
  return spy.mock.calls.some(([url]) => String(url).includes('/workfile'));
}

/**
 * `fetch` mockeado que enruta por MÉTODO + RUTA del backend, cubriendo todo el
 * recorrido de integración:
 *   - GET  /render/{id}     → respuesta ampliada (esperando_eleccion_render).
 *   - GET  /configuracion   → { ajustes: null }   (carga inicial del estilo).
 *   - PUT  /configuracion   → { guardado: true }  (guardar estilo).
 *   - POST /render/{id}      → 202 { job_id, estado } (confirmar render).
 */
const fetchMock = vi.fn(
  (url: string | URL, init?: RequestInit): Promise<Response> => {
    const u = String(url);
    const metodo = metodoDe(init);

    if (u.includes('/render/') && metodo === 'GET') {
      return Promise.resolve(respuestaJson(respuestaRenderAmpliada()));
    }
    if (u.includes('/render/') && metodo === 'POST') {
      // El backend acepta la elección y reanuda el pipeline (202).
      return Promise.resolve(
        respuestaJson({ job_id: JOB_ID, estado: 'en_ejecucion' }, 202),
      );
    }
    if (u.includes('/configuracion') && metodo === 'GET') {
      return Promise.resolve(respuestaJson({ ajustes: null }));
    }
    if (u.includes('/configuracion') && metodo === 'PUT') {
      return Promise.resolve(
        respuestaJson({ guardado: true, ajustes: AJUSTES_POR_DEFECTO }),
      );
    }
    // Cualquier otra ruta no esperada: respuesta vacía neutra.
    return Promise.resolve(respuestaJson({}, 200));
  },
);

/** Devuelve las llamadas a `fetch` que coinciden con una ruta y método. */
function llamadas(ruta: string, metodo: string) {
  return fetchMock.mock.calls.filter(
    ([u, i]) => String(u).includes(ruta) && metodoDe(i as RequestInit) === metodo,
  );
}

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Flujo de integración preview Remotion (7.3)', () => {
  it('FLUJO 1 (Remotion con preview): toggle ON → guardar estilo → confirmar → onElegido("remotion") (Req 5.3, 6.3)', async () => {
    const onElegido = vi.fn();

    // Se monta SOLO con jobId + onElegido: sin inyectar funciones de lib/api,
    // de modo que el flujo use el transporte real (fetch mockeado).
    render(<EleccionRender jobId={JOB_ID} onElegido={onElegido} />);

    // 1) Carga inicial: GET /render/{id} (respuesta ampliada).
    await waitFor(() => expect(llamadas('/render/', 'GET').length).toBe(1));

    // El toggle aparece HABILITADO (hay video_url) y desactivado por defecto.
    const toggle = await screen.findByTestId('toggle-preview-remotion');
    expect(toggle).not.toBeChecked();
    expect(toggle).not.toBeDisabled();
    // Aún no hay preview ni Player.
    expect(screen.queryByTestId('preview-remotion-real')).toBeNull();
    expect(screen.queryByTestId('player-mock')).toBeNull();

    // 2) Activar el toggle → se monta la preview (que a su vez carga el estilo
    //    con GET /configuracion y monta el Player con el vídeo REAL).
    fireEvent.click(toggle);

    const preview = await screen.findByTestId('preview-remotion-real');
    expect(preview).toBeInTheDocument();
    const player = await screen.findByTestId('player-mock');
    // El Player recibe el vídeo real (video_url) como fondo.
    expect(player).toHaveAttribute('data-video-src', VIDEO_URL);
    // La preview cargó el estilo guardado: GET /configuracion.
    await waitFor(() => expect(llamadas('/configuracion', 'GET').length).toBe(1));

    // 3) Ajustar un campo de estilo y "Guardar estilo" → PUT /configuracion.
    fireEvent.change(screen.getByTestId('estilo-tamano'), {
      target: { value: '142' },
    });
    fireEvent.click(screen.getByTestId('guardar-estilo'));

    await waitFor(() => expect(llamadas('/configuracion', 'PUT').length).toBe(1));
    // El cuerpo del PUT incluye el estilo actual (tamano=142) proyectado sobre
    // ajustes.subtitulos (ajustesConEstilo).
    const [, putInit] = llamadas('/configuracion', 'PUT')[0];
    const cuerpoPut = JSON.parse(String((putInit as RequestInit)?.body));
    expect(cuerpoPut.ajustes.subtitulos.tamano).toBe(142);

    // Mensaje de éxito visible (Req 5.3), sin error.
    const mensaje = await screen.findByTestId('guardar-mensaje');
    expect(mensaje).toHaveTextContent('Estilo guardado');
    expect(screen.queryByTestId('guardar-error')).toBeNull();
    // Guardar el estilo NO dispara el render todavía.
    expect(llamadas('/render/', 'POST').length).toBe(0);
    expect(onElegido).not.toHaveBeenCalled();

    // 4) "Confirmar y renderizar" → POST /render/{id} { motor: 'remotion' }.
    fireEvent.click(screen.getByTestId('confirmar-render'));

    await waitFor(() => expect(llamadas('/render/', 'POST').length).toBe(1));
    const [postUrl, postInit] = llamadas('/render/', 'POST')[0];
    expect(String(postUrl)).toContain(`/render/${JOB_ID}`);
    const cuerpoPost = JSON.parse(String((postInit as RequestInit)?.body));
    expect(cuerpoPost.motor).toBe('remotion');

    // En 202, onRenderConfirmado cablea onElegido('remotion') (Req 6.3).
    await waitFor(() => expect(onElegido).toHaveBeenCalledWith('remotion'));
    expect(screen.queryByTestId('render-error')).toBeNull();
  });

  it('FLUJO 2 (ffmpeg sin preview): elegir "ffmpeg" → POST /render {ass}, onElegido("ass") y NUNCA consulta /workfile ni monta el Player (Req 7.3)', async () => {
    const onElegido = vi.fn();

    render(<EleccionRender jobId={JOB_ID} onElegido={onElegido} />);

    await waitFor(() => expect(llamadas('/render/', 'GET').length).toBe(1));
    // El toggle está disponible pero NO se activa (camino ffmpeg).
    await screen.findByTestId('toggle-preview-remotion');

    // Elegir "ffmpeg" directamente con los botones de motor.
    fireEvent.click(screen.getByTestId('eleccion-motor-ass'));

    // POST /render/{id} con { motor: 'ass' }.
    await waitFor(() => expect(llamadas('/render/', 'POST').length).toBe(1));
    const [, postInit] = llamadas('/render/', 'POST')[0];
    const cuerpoPost = JSON.parse(String((postInit as RequestInit)?.body));
    expect(cuerpoPost.motor).toBe('ass');
    await waitFor(() => expect(onElegido).toHaveBeenCalledWith('ass'));

    // El camino ffmpeg NO monta la preview ni el Player…
    expect(screen.queryByTestId('preview-remotion-real')).toBeNull();
    expect(screen.queryByTestId('player-mock')).toBeNull();
    // …y por tanto NUNCA carga el estilo ni consulta /workfile (aislamiento).
    expect(llamadas('/configuracion', 'GET').length).toBe(0);
    expect(huboLlamadaAWorkfile(fetchMock)).toBe(false);
  });

  it('AISLAMIENTO (Req 9.4): si el Player lanza, se muestra el error del vídeo pero confirmar sigue operativo', async () => {
    // Simula un fallo de carga/reproducción del vídeo: el Player lanza al montar.
    estadoPlayerMock.lanzar = true;
    // Silenciamos console.error: el Error Boundary y React registran el fallo.
    const spyError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onElegido = vi.fn();

    render(<EleccionRender jobId={JOB_ID} onElegido={onElegido} />);

    await waitFor(() => expect(llamadas('/render/', 'GET').length).toBe(1));

    // Activar el toggle: la preview se monta pero el Player falla → video-error.
    fireEvent.click(await screen.findByTestId('toggle-preview-remotion'));

    expect(await screen.findByTestId('preview-remotion-real')).toBeInTheDocument();
    expect(await screen.findByTestId('video-error')).toBeInTheDocument();
    // El Player no llegó a montarse (lanzó), pero el resto de la UI sigue viva.
    expect(screen.queryByTestId('player-mock')).toBeNull();

    // Pese al fallo del vídeo, "Confirmar y renderizar" sigue operativo:
    const confirmar = screen.getByTestId('confirmar-render');
    expect(confirmar).not.toBeDisabled();
    fireEvent.click(confirmar);

    await waitFor(() => expect(llamadas('/render/', 'POST').length).toBe(1));
    const [, postInit] = llamadas('/render/', 'POST')[0];
    const cuerpoPost = JSON.parse(String((postInit as RequestInit)?.body));
    expect(cuerpoPost.motor).toBe('remotion');
    await waitFor(() => expect(onElegido).toHaveBeenCalledWith('remotion'));

    // El aviso del vídeo sigue visible; el editor no se rompió (Req 9.4).
    expect(screen.getByTestId('video-error')).toBeInTheDocument();
    expect(spyError).toHaveBeenCalled();
    spyError.mockRestore();
  });
});
