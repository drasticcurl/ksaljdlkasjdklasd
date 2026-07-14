/**
 * Tests de `EleccionRender` — tareas 6.1 y 6.2.
 *
 * Tarea 6.1 (toggle de previsualización y almacenamiento de los datos del vídeo
 * real):
 *   - El toggle "Previsualizar con vídeo real (Remotion)" está presente y
 *     DESACTIVADO por defecto (Req 2.1, 2.5).
 *   - Cuando `video_url` es `null`, el toggle está DESHABILITADO y se muestra
 *     un aviso de previsualización no disponible (Req 2.2, 9.2).
 *   - Cuando hay `video_url`, el toggle queda HABILITADO y puede activarse, sin
 *     aviso.
 *   - El comportamiento previo (dos botones de motor) permanece intacto.
 *
 * Tarea 6.2 (montaje/desmontaje de `PreviewRemotionReal`):
 *   - Activar el toggle MONTA la previsualización (`preview-remotion-real`);
 *     desactivarlo la DESMONTA (Req 2.3, 2.4).
 *   - Elegir "ffmpeg" NO monta el Player ni la preview (Req 7.1, 7.2, 7.3).
 *   - Confirmar el render desde la preview (`onRenderConfirmado`) dispara
 *     `onElegido('remotion')` (Req 6.3).
 *
 * Tarea 7.2 (consolidación de la cobertura de los criterios de aceptación):
 *   Este archivo ya acumulaba, de las tareas 6.1 y 6.2, los tests de toggle
 *   desactivado por defecto, deshabilitado + aviso con `video_url` null, montaje
 *   al activar, desmontaje al desactivar, aislamiento del flujo ffmpeg y
 *   resaltado del `motor_preferido`. La tarea 7.2 revisa que esa cobertura sea
 *   COMPLETA para los criterios 2.1, 2.2, 2.3, 2.4, 7.1, 7.2 y 9.2, y añade lo
 *   que faltaba (bloque `EleccionRender (7.2)` al final del archivo):
 *     - Aserción EXPLÍCITA de que el flujo ffmpeg NUNCA consulta `/workfile`
 *       (el `<Player>` —único consumidor de `/workfile`— no se monta) (Req 7.1,
 *       7.2).
 *     - Resaltado del `motor_preferido` cuando vale `'remotion'` (robustez del
 *       criterio de "resaltado intacto").
 *     - Con `video_url` null, además de deshabilitar el toggle, los dos botones
 *       de elección de motor siguen DISPONIBLES (Req 9.2).
 *
 * Mapeo criterio → test (ver bloques `describe` de este archivo):
 *   - Req 2.1  → "muestra el toggle DESACTIVADO por defecto…" + "mantiene
 *                intactos los dos botones…"
 *   - Req 2.2  → "deshabilita el toggle y muestra aviso cuando video_url es null"
 *   - Req 2.3  → "activar el toggle MONTA la previsualización…"
 *   - Req 2.4  → "desactivar el toggle DESMONTA la previsualización"
 *   - Req 7.1/7.2 → "elegir \"ffmpeg\" NO monta el Player ni la preview" +
 *                   (7.2) "elegir \"ffmpeg\" NUNCA consulta /workfile…"
 *   - Req 9.2  → "deshabilita el toggle y muestra aviso…" + (7.2) "con video_url
 *                null los botones de motor siguen disponibles"
 *   - Resaltado motor_preferido → "mantiene intactos los dos botones…" (ass) +
 *                (7.2) "resalta el botón cuando motor_preferido es 'remotion'"
 *
 * Se inyecta `obtenerFn` para simular la respuesta ampliada de `GET /render`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// El montaje de `PreviewRemotionReal` (tarea 6.2) arrastra `@remotion/player`,
// que no puede reproducir vídeo en jsdom. Se sustituye por un stub que expone el
// `videoSrc` recibido para poder aseverar que el Player solo se monta con la
// preview activa (igual que en `PreviewRemotionReal.test.tsx`).
vi.mock('@remotion/player', () => ({
  Player: (props: { inputProps?: { videoSrc?: string } }) => (
    <div
      data-testid="player-mock"
      data-video-src={props.inputProps?.videoSrc ?? ''}
    />
  ),
}));

// `PreviewRemotionReal` (montada por la tarea 6.2) precarga el estilo con
// `obtenerConfiguracion` al montar. Se hace un mock PARCIAL de `@/lib/api` para
// que esa carga sea determinista y no toque la red, conservando el resto de la
// API real (`ApiError`, `elegirRender`, `obtenerRender`, etc.).
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    obtenerConfiguracion: vi.fn().mockResolvedValue({ ajustes: null }),
    guardarConfiguracion: vi
      .fn()
      .mockResolvedValue({ guardado: true, ajustes: null }),
  };
});

import EleccionRender from '../EleccionRender';
import type { RenderEleccion } from '@/lib/types';

/** Construye una respuesta ampliada de `GET /render` con overrides. */
function respuestaRender(
  overrides: Partial<RenderEleccion> = {},
): RenderEleccion {
  return {
    job_id: 'job-123',
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
    video_url: 'http://127.0.0.1:8000/workfile/job-123/cortado.mp4',
    video_nombre: 'cortado.mp4',
    fps: 30,
    ancho: 1080,
    alto: 1920,
    duracion_s: 2,
    ...overrides,
  };
}

describe('EleccionRender (6.1) — toggle de previsualización', () => {
  it('muestra el toggle DESACTIVADO por defecto cuando hay vídeo (Req 2.1, 2.5)', async () => {
    const obtenerFn = vi.fn().mockResolvedValue(respuestaRender());

    render(<EleccionRender jobId="job-123" obtenerFn={obtenerFn} />);

    // Se espera a que termine la carga inicial.
    await waitFor(() => expect(obtenerFn).toHaveBeenCalledTimes(1));

    const toggle = await screen.findByTestId('toggle-preview-remotion');
    expect(toggle).toBeInTheDocument();
    // Desactivado por defecto (Req 2.5).
    expect(toggle).not.toBeChecked();
    // Habilitado porque hay `video_url`.
    expect(toggle).not.toBeDisabled();
    // Sin aviso de "no disponible".
    expect(screen.queryByTestId('preview-no-disponible')).toBeNull();
  });

  it('deshabilita el toggle y muestra aviso cuando video_url es null (Req 2.2, 9.2)', async () => {
    const obtenerFn = vi
      .fn()
      .mockResolvedValue(
        respuestaRender({ video_url: null, video_nombre: null, duracion_s: null }),
      );

    render(<EleccionRender jobId="job-123" obtenerFn={obtenerFn} />);

    await waitFor(() => expect(obtenerFn).toHaveBeenCalledTimes(1));

    const toggle = await screen.findByTestId('toggle-preview-remotion');
    expect(toggle).toBeDisabled();
    // Se informa de que la previsualización no está disponible.
    expect(screen.getByTestId('preview-no-disponible')).toBeInTheDocument();
  });

  it('permite activar el toggle cuando hay video_url (Req 2.1)', async () => {
    const obtenerFn = vi.fn().mockResolvedValue(respuestaRender());

    render(<EleccionRender jobId="job-123" obtenerFn={obtenerFn} />);

    await waitFor(() => expect(obtenerFn).toHaveBeenCalledTimes(1));

    const toggle = await screen.findByTestId('toggle-preview-remotion');
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);

    await waitFor(() =>
      expect(screen.getByTestId('toggle-preview-remotion')).toBeChecked(),
    );
  });

  it('mantiene intactos los dos botones de elección de motor', async () => {
    const obtenerFn = vi.fn().mockResolvedValue(respuestaRender());

    render(<EleccionRender jobId="job-123" obtenerFn={obtenerFn} />);

    await waitFor(() => expect(obtenerFn).toHaveBeenCalledTimes(1));

    expect(await screen.findByTestId('eleccion-motor-remotion')).toBeInTheDocument();
    expect(screen.getByTestId('eleccion-motor-ass')).toBeInTheDocument();
    // El botón preferido (`ass`) se sigue resaltando.
    expect(screen.getByTestId('eleccion-motor-ass').className).toContain(
      'ring-2',
    );
  });
});


describe('EleccionRender (6.2) — montaje/desmontaje de PreviewRemotionReal', () => {
  it('activar el toggle MONTA la previsualización con el vídeo real (Req 2.3)', async () => {
    const obtenerFn = vi.fn().mockResolvedValue(respuestaRender());

    render(<EleccionRender jobId="job-123" obtenerFn={obtenerFn} />);

    await waitFor(() => expect(obtenerFn).toHaveBeenCalledTimes(1));

    // Antes de activar el toggle, la preview NO está montada.
    expect(screen.queryByTestId('preview-remotion-real')).toBeNull();
    expect(screen.queryByTestId('player-mock')).toBeNull();

    // Activamos el toggle → se monta la preview (y su Player) con el vídeo real.
    fireEvent.click(screen.getByTestId('toggle-preview-remotion'));

    const preview = await screen.findByTestId('preview-remotion-real');
    expect(preview).toBeInTheDocument();
    const player = await screen.findByTestId('player-mock');
    expect(player).toHaveAttribute(
      'data-video-src',
      'http://127.0.0.1:8000/workfile/job-123/cortado.mp4',
    );
  });

  it('desactivar el toggle DESMONTA la previsualización (Req 2.4)', async () => {
    const obtenerFn = vi.fn().mockResolvedValue(respuestaRender());

    render(<EleccionRender jobId="job-123" obtenerFn={obtenerFn} />);

    await waitFor(() => expect(obtenerFn).toHaveBeenCalledTimes(1));

    const toggle = screen.getByTestId('toggle-preview-remotion');
    // Montar…
    fireEvent.click(toggle);
    expect(await screen.findByTestId('preview-remotion-real')).toBeInTheDocument();

    // …y desmontar al desactivar.
    fireEvent.click(screen.getByTestId('toggle-preview-remotion'));
    await waitFor(() =>
      expect(screen.queryByTestId('preview-remotion-real')).toBeNull(),
    );
    // El Player también se liberó.
    expect(screen.queryByTestId('player-mock')).toBeNull();
  });

  it('elegir "ffmpeg" NO monta el Player ni la preview (Req 7.1, 7.2, 7.3)', async () => {
    const obtenerFn = vi.fn().mockResolvedValue(respuestaRender());
    const elegirFn = vi
      .fn()
      .mockResolvedValue({ job_id: 'job-123', estado: 'en_ejecucion' });
    const onElegido = vi.fn();

    render(
      <EleccionRender
        jobId="job-123"
        obtenerFn={obtenerFn}
        elegirFn={elegirFn}
        onElegido={onElegido}
      />,
    );

    await waitFor(() => expect(obtenerFn).toHaveBeenCalledTimes(1));

    // Elegir ffmpeg sin activar el toggle.
    fireEvent.click(screen.getByTestId('eleccion-motor-ass'));

    await waitFor(() => expect(elegirFn).toHaveBeenCalledTimes(1));
    // Se llama con el motor "ass" (flujo ffmpeg intacto).
    const [, motorArg] = elegirFn.mock.calls[0];
    expect(motorArg).toBe('ass');
    await waitFor(() => expect(onElegido).toHaveBeenCalledWith('ass'));

    // NO se monta el Player ni la preview (no consulta /workfile).
    expect(screen.queryByTestId('preview-remotion-real')).toBeNull();
    expect(screen.queryByTestId('player-mock')).toBeNull();
  });

  it('confirmar el render desde la preview dispara onElegido("remotion") (Req 6.3)', async () => {
    const obtenerFn = vi.fn().mockResolvedValue(respuestaRender());
    // La preview usa la misma inyección `elegirFn` de EleccionRender.
    const elegirFn = vi
      .fn()
      .mockResolvedValue({ job_id: 'job-123', estado: 'en_ejecucion' });
    const onElegido = vi.fn();

    render(
      <EleccionRender
        jobId="job-123"
        obtenerFn={obtenerFn}
        elegirFn={elegirFn}
        onElegido={onElegido}
      />,
    );

    await waitFor(() => expect(obtenerFn).toHaveBeenCalledTimes(1));

    // Montamos la preview.
    fireEvent.click(screen.getByTestId('toggle-preview-remotion'));
    await screen.findByTestId('preview-remotion-real');

    // Confirmamos el render dentro de la preview.
    fireEvent.click(screen.getByTestId('confirmar-render'));

    // La preview llama a elegirFn(jobId, "remotion")…
    await waitFor(() => expect(elegirFn).toHaveBeenCalledTimes(1));
    const [jobIdArg, motorArg] = elegirFn.mock.calls[0];
    expect(jobIdArg).toBe('job-123');
    expect(motorArg).toBe('remotion');

    // …y en éxito `onRenderConfirmado` cablea `onElegido('remotion')` (Req 6.3).
    await waitFor(() => expect(onElegido).toHaveBeenCalledWith('remotion'));
  });
});



describe('EleccionRender (7.2) — consolidación de la cobertura de criterios', () => {
  // La preview (único punto que monta el `<Player>`, y por tanto el único que
  // reproduciría el vídeo desde `GET /workfile`) no debe montarse en el flujo
  // ffmpeg. Para aseverarlo de forma EXPLÍCITA espiamos `global.fetch` y
  // comprobamos que jamás se solicita una URL que contenga `/workfile`.
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Devuelve `true` si alguna llamada a fetch apuntó a una URL con `/workfile`. */
  function huboLlamadaAWorkfile(spy: ReturnType<typeof vi.fn>): boolean {
    return spy.mock.calls.some(([entrada]) => {
      const url =
        typeof entrada === 'string'
          ? entrada
          : entrada instanceof URL
            ? entrada.toString()
            : ((entrada as Request)?.url ?? '');
      return url.includes('/workfile');
    });
  }

  it('elegir "ffmpeg" NUNCA consulta /workfile ni monta el Player (Req 7.1, 7.2)', async () => {
    const obtenerFn = vi.fn().mockResolvedValue(respuestaRender());
    const elegirFn = vi
      .fn()
      .mockResolvedValue({ job_id: 'job-123', estado: 'en_ejecucion' });
    const onElegido = vi.fn();

    render(
      <EleccionRender
        jobId="job-123"
        obtenerFn={obtenerFn}
        elegirFn={elegirFn}
        onElegido={onElegido}
      />,
    );

    await waitFor(() => expect(obtenerFn).toHaveBeenCalledTimes(1));

    // Flujo ffmpeg: se elige "ass" sin activar el toggle de previsualización.
    fireEvent.click(screen.getByTestId('eleccion-motor-ass'));

    await waitFor(() => expect(elegirFn).toHaveBeenCalledTimes(1));
    const [, motorArg] = elegirFn.mock.calls[0];
    expect(motorArg).toBe('ass');
    await waitFor(() => expect(onElegido).toHaveBeenCalledWith('ass'));

    // El Player (único consumidor de /workfile) no se monta y no hay preview…
    expect(screen.queryByTestId('preview-remotion-real')).toBeNull();
    expect(screen.queryByTestId('player-mock')).toBeNull();
    // …y de forma explícita: NINGUNA petición de red fue a /workfile.
    expect(huboLlamadaAWorkfile(fetchSpy)).toBe(false);
  });

  it('resalta el botón cuando motor_preferido es "remotion" (resaltado intacto)', async () => {
    const obtenerFn = vi
      .fn()
      .mockResolvedValue(respuestaRender({ motor_preferido: 'remotion' }));

    render(<EleccionRender jobId="job-123" obtenerFn={obtenerFn} />);

    await waitFor(() => expect(obtenerFn).toHaveBeenCalledTimes(1));

    // Ahora el botón preferido es Remotion: es el que lleva el anillo de resalte.
    const remotion = await screen.findByTestId('eleccion-motor-remotion');
    const ass = screen.getByTestId('eleccion-motor-ass');
    expect(remotion.className).toContain('ring-2');
    expect(ass.className).not.toContain('ring-2');
  });

  it('con video_url null deshabilita el toggle pero deja disponibles los botones de motor (Req 9.2)', async () => {
    const obtenerFn = vi
      .fn()
      .mockResolvedValue(
        respuestaRender({ video_url: null, video_nombre: null, duracion_s: null }),
      );

    render(<EleccionRender jobId="job-123" obtenerFn={obtenerFn} />);

    await waitFor(() => expect(obtenerFn).toHaveBeenCalledTimes(1));

    // El toggle está deshabilitado y hay aviso de "no disponible" (Req 2.2, 9.2).
    expect(await screen.findByTestId('toggle-preview-remotion')).toBeDisabled();
    expect(screen.getByTestId('preview-no-disponible')).toBeInTheDocument();

    // Pero la elección de motor por botones sigue OFRECIÉNDOSE y operativa.
    expect(screen.getByTestId('eleccion-motor-remotion')).not.toBeDisabled();
    expect(screen.getByTestId('eleccion-motor-ass')).not.toBeDisabled();
    // Sin `video_url`, la preview nunca se monta aunque no pueda activarse.
    expect(screen.queryByTestId('preview-remotion-real')).toBeNull();
    expect(screen.queryByTestId('player-mock')).toBeNull();
  });
});
