/**
 * Tests de `PreviewRemotionReal`.
 *
 * Este archivo se fue construyendo de forma incremental durante el grupo 5
 * (tareas 5.1–5.6) y se CONSOLIDA en la tarea 7.1, que exige cobertura de UI de
 * los criterios de aceptación Req 3.1, 4.2, 4.3, 5.2 y 6.2 con `vitest` +
 * Testing Library, usando mock de `@remotion/player` y de `lib/api`.
 *
 * -------------------------------------------------------------------------
 * MAPEO CRITERIO DE ACEPTACIÓN (tarea 7.1) → TEST QUE LO CUBRE
 *   - Req 3.1 (monta el Player con `videoSrc` NO vacío = `video_url`):
 *       · "(5.2) monta el Player dentro del wrapper con el vídeo real de fondo"
 *       · "(5.2) pasa videoSrc NO vacío (video_url) al Player (Req 3.1)"
 *   - Req 4.2 (cambios de estilo NO recargan el vídeo):
 *       · "(5.3) al cambiar un control de estilo actualiza el estilo del Player
 *          SIN recargar el vídeo (Req 4.2)"
 *   - Req 4.3 (el texto NO es editable):
 *       · "(5.3) no expone ningún control para editar el texto de los grupos"
 *   - Req 5.2 ("Guardar estilo" llama a `PUT /configuracion`):
 *       · "(5.4) llama a guardarConfigFn con los ajustes... (ajustesConEstilo)"
 *         (nivel función inyectada) y, a nivel HTTP,
 *       · "(7.1) 'Guardar estilo' llama al backend con PUT /configuracion"
 *   - Req 6.2 ("Confirmar" llama a `POST /render` con `remotion`):
 *       · "(5.5) confirma llamando a elegirFn con (jobId, 'remotion')..."
 *         (nivel función inyectada) y, a nivel HTTP,
 *       · "(7.1) 'Confirmar y renderizar' llama al backend con POST /render y
 *          motor 'remotion'"
 *
 * El bloque "(7.1)" del final cierra explícitamente el mapeo criterio→transporte
 * HTTP: verifica que la función por defecto `guardarConfiguracion` se traduce en
 * un `PUT /configuracion` y que `elegirRender` se traduce en un
 * `POST /render/{id}` con `{ motor: "remotion" }`, mockeando `lib/api` a nivel de
 * su transporte (`fetch`) en lugar de inyectar funciones falsas.
 * -------------------------------------------------------------------------
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// Estado compartido y "hoisted" para controlar el comportamiento del mock del
// Player. Por defecto NO lanza (comportamiento normal de 5.1–5.5); cuando
// `lanzar` es `true`, el mock del Player lanza al renderizar para simular un
// fallo de carga/reproducción del vídeo (códec/red) y así probar el manejo de
// errores de la tarea 5.6 (Error Boundary).
const estadoPlayerMock = vi.hoisted(() => ({ lanzar: false }));

// Mock de `@remotion/player`: en jsdom el Player real no puede reproducir vídeo,
// así que se sustituye por un stub que expone las props relevantes (el
// `videoSrc` de `inputProps` y `durationInFrames`) mediante atributos `data-*`,
// para poder aseverar que el Player se monta con el vídeo real de fondo (5.2).
//
// Para la tarea 5.6, si `estadoPlayerMock.lanzar` está activo, el mock lanza al
// renderizar; así el `LimiteErrorVideo` (Error Boundary) que envuelve al Player
// debe capturar el fallo y mostrar `video-error` sin romper el resto de la UI.
vi.mock('@remotion/player', () => ({
  Player: (props: {
    inputProps?: { videoSrc?: string; estilo?: { tamano?: number; color?: string } };
    durationInFrames?: number;
  }) => {
    if (estadoPlayerMock.lanzar) {
      throw new Error('No se pudo cargar el vídeo de fondo (simulado)');
    }
    return (
      <div
        data-testid="player-mock"
        data-video-src={props.inputProps?.videoSrc ?? ''}
        data-duration={String(props.durationInFrames ?? '')}
        data-estilo-tamano={String(props.inputProps?.estilo?.tamano ?? '')}
        data-estilo-color={props.inputProps?.estilo?.color ?? ''}
      />
    );
  },
}));

// Tras cada test se restablece el mock a "no lanzar" para no contaminar otros.
afterEach(() => {
  estadoPlayerMock.lanzar = false;
});

import PreviewRemotionReal from '../PreviewRemotionReal';
import { ApiError } from '@/lib/api';
import { AJUSTES_POR_DEFECTO } from '@/lib/defaults';
import type { GrupoSubtituloConPalabras } from '@/lib/types';

/** Grupos mínimos de prueba (segundos), con palabras opcionales. */
const GRUPOS: GrupoSubtituloConPalabras[] = [
  {
    texto: 'hola mundo',
    inicio_s: 0,
    fin_s: 2,
    palabras: [
      { texto: 'hola', inicio_s: 0, fin_s: 1 },
      { texto: 'mundo', inicio_s: 1, fin_s: 2 },
    ],
  },
];

/** Props base reutilizables para montar el componente. */
function propsBase() {
  return {
    jobId: 'job-123',
    grupos: GRUPOS,
    videoUrl: 'http://127.0.0.1:8000/workfile/job-123/cortado.mp4',
    width: 1080,
    height: 1920,
    fps: 30,
    duracionS: 2,
  };
}

describe('PreviewRemotionReal (5.1)', () => {
  it('monta la estructura básica del componente', async () => {
    const obtenerConfigFn = vi.fn().mockResolvedValue({ ajustes: null });
    render(
      <PreviewRemotionReal {...propsBase()} obtenerConfigFn={obtenerConfigFn} />,
    );

    expect(screen.getByTestId('preview-remotion-real')).toBeInTheDocument();
    // La carga inicial se dispara al montar.
    await waitFor(() => expect(obtenerConfigFn).toHaveBeenCalledTimes(1));
  });

  it('precarga el estilo desde GET /configuracion al montar (Req 4.4)', async () => {
    // Config con un estilo distinguible del por defecto.
    const ajustes = {
      ...AJUSTES_POR_DEFECTO,
      subtitulos: {
        ...AJUSTES_POR_DEFECTO.subtitulos,
        color: '#123456',
        tamano: 111,
      },
    };
    const obtenerConfigFn = vi.fn().mockResolvedValue({ ajustes });

    render(
      <PreviewRemotionReal {...propsBase()} obtenerConfigFn={obtenerConfigFn} />,
    );

    await waitFor(() => expect(obtenerConfigFn).toHaveBeenCalledTimes(1));
    // El componente sigue montado y no rompe tras aplicar el estilo cargado.
    expect(screen.getByTestId('preview-remotion-real')).toBeInTheDocument();
  });

  it('no rompe si la carga de configuración falla', async () => {
    const obtenerConfigFn = vi.fn().mockRejectedValue(new Error('red caída'));

    render(
      <PreviewRemotionReal {...propsBase()} obtenerConfigFn={obtenerConfigFn} />,
    );

    await waitFor(() => expect(obtenerConfigFn).toHaveBeenCalledTimes(1));
    // Se conserva la estructura (estilo por defecto) sin propagar el error.
    expect(screen.getByTestId('preview-remotion-real')).toBeInTheDocument();
  });
});

describe('PreviewRemotionReal (5.2) — montaje del Player', () => {
  it('monta el Player dentro del wrapper con el vídeo real de fondo', async () => {
    const obtenerConfigFn = vi.fn().mockResolvedValue({ ajustes: null });
    render(
      <PreviewRemotionReal {...propsBase()} obtenerConfigFn={obtenerConfigFn} />,
    );

    // El Player se monta dentro del contenedor `player-wrapper` (como el playground).
    const wrapper = screen.getByTestId('player-wrapper');
    expect(wrapper).toBeInTheDocument();

    const player = screen.getByTestId('player-mock');
    expect(wrapper).toContainElement(player);
  });

  it('pasa videoSrc NO vacío (video_url) al Player (Req 3.1)', async () => {
    const obtenerConfigFn = vi.fn().mockResolvedValue({ ajustes: null });
    const props = propsBase();
    render(
      <PreviewRemotionReal {...props} obtenerConfigFn={obtenerConfigFn} />,
    );

    const player = screen.getByTestId('player-mock');
    // videoSrc === videoUrl (no vacío) => fondo de vídeo real.
    expect(player).toHaveAttribute('data-video-src', props.videoUrl);
    expect(player.getAttribute('data-video-src')).not.toBe('');
  });

  it('deriva durationInFrames de duracion_s * fps (Req 3.6)', async () => {
    const obtenerConfigFn = vi.fn().mockResolvedValue({ ajustes: null });
    // duracionS=2, fps=30 => ceil(2*30) = 60 frames.
    render(
      <PreviewRemotionReal
        {...propsBase()}
        duracionS={2}
        fps={30}
        obtenerConfigFn={obtenerConfigFn}
      />,
    );

    const player = screen.getByTestId('player-mock');
    expect(player).toHaveAttribute('data-duration', '60');
  });
});

describe('PreviewRemotionReal (5.3) — panel de estilo y re-render en vivo', () => {
  it('renderiza el panel de estilo reutilizable (EstiloSubtitulos)', async () => {
    const obtenerConfigFn = vi.fn().mockResolvedValue({ ajustes: null });
    render(
      <PreviewRemotionReal {...propsBase()} obtenerConfigFn={obtenerConfigFn} />,
    );

    // El panel de estilo está presente...
    expect(screen.getByTestId('panel-estilo')).toBeInTheDocument();
    // ...y expone los controles de estilo de `EstiloSubtitulos` (Req 4.1).
    expect(screen.getByTestId('estilo-tamano')).toBeInTheDocument();
    expect(screen.getByTestId('estilo-color')).toBeInTheDocument();
    expect(screen.getByTestId('estilo-negrita')).toBeInTheDocument();
  });

  it('al cambiar un control de estilo actualiza el estilo del Player SIN recargar el vídeo (Req 4.2)', async () => {
    const obtenerConfigFn = vi.fn().mockResolvedValue({ ajustes: null });
    const props = propsBase();
    render(
      <PreviewRemotionReal {...props} obtenerConfigFn={obtenerConfigFn} />,
    );
    // Se espera a que termine la carga inicial del estilo para partir de un
    // estado estable.
    await waitFor(() => expect(obtenerConfigFn).toHaveBeenCalledTimes(1));

    const player = screen.getByTestId('player-mock');
    // Referencia inicial del vídeo de fondo.
    const videoSrcInicial = player.getAttribute('data-video-src');
    expect(videoSrcInicial).toBe(props.videoUrl);

    // Cambiar el tamaño del texto en el panel de estilo.
    const control = screen.getByTestId('estilo-tamano');
    fireEvent.change(control, { target: { value: '150' } });

    // El nuevo estilo llega al Player...
    await waitFor(() =>
      expect(screen.getByTestId('player-mock')).toHaveAttribute(
        'data-estilo-tamano',
        '150',
      ),
    );
    // ...pero el vídeo de fondo NO cambia (mismo videoSrc => no se recarga).
    expect(screen.getByTestId('player-mock')).toHaveAttribute(
      'data-video-src',
      props.videoUrl,
    );
    expect(screen.getByTestId('player-mock').getAttribute('data-video-src')).toBe(
      videoSrcInicial,
    );
  });

  it('no expone ningún control para editar el texto de los grupos (Req 4.3)', async () => {
    const obtenerConfigFn = vi.fn().mockResolvedValue({ ajustes: null });
    render(
      <PreviewRemotionReal {...propsBase()} obtenerConfigFn={obtenerConfigFn} />,
    );

    // No debe existir ninguna caja de texto/área de texto para editar el texto
    // de los grupos: el texto es de solo lectura en esta vista.
    expect(screen.queryByRole('textbox')).toBeNull();
    // Y el texto del grupo no debe aparecer dentro de un input editable.
    const inputsTexto = document.querySelectorAll(
      'input[type="text"], textarea',
    );
    expect(inputsTexto.length).toBe(0);
  });
});

describe('PreviewRemotionReal (5.4) — Guardar estilo', () => {
  it('llama a guardarConfigFn con los ajustes que incluyen el estilo actual (ajustesConEstilo)', async () => {
    // Sin config guardada: se parte de AJUSTES_POR_DEFECTO y el estilo por defecto.
    const obtenerConfigFn = vi.fn().mockResolvedValue({ ajustes: null });
    const guardarConfigFn = vi
      .fn()
      .mockResolvedValue({ guardado: true, ajustes: AJUSTES_POR_DEFECTO });

    render(
      <PreviewRemotionReal
        {...propsBase()}
        obtenerConfigFn={obtenerConfigFn}
        guardarConfigFn={guardarConfigFn}
      />,
    );

    // Se espera a la carga inicial para partir de un estado estable.
    await waitFor(() => expect(obtenerConfigFn).toHaveBeenCalledTimes(1));

    // Cambiamos el tamaño del texto para distinguirlo del valor por defecto.
    fireEvent.change(screen.getByTestId('estilo-tamano'), {
      target: { value: '133' },
    });

    // Pulsamos "Guardar estilo".
    fireEvent.click(screen.getByTestId('guardar-estilo'));

    // Se persiste con guardarConfigFn y los ajustes incluyen el estilo actual:
    // ajustesConEstilo proyecta estilo.tamano -> subtitulos.tamano.
    await waitFor(() => expect(guardarConfigFn).toHaveBeenCalledTimes(1));
    const [ajustesEnviados] = guardarConfigFn.mock.calls[0];
    expect(ajustesEnviados.subtitulos.tamano).toBe(133);
    // El resto de ajustes base se conserva (no se altera `generales`, etc.).
    expect(ajustesEnviados.generales).toEqual(AJUSTES_POR_DEFECTO.generales);
  });

  it('usa la config vigente como base cuando existe (obtenerConfigFn)', async () => {
    const ajustesGuardados = {
      ...AJUSTES_POR_DEFECTO,
      subtitulos: {
        ...AJUSTES_POR_DEFECTO.subtitulos,
        color: '#abcdef',
      },
    };
    const obtenerConfigFn = vi
      .fn()
      .mockResolvedValue({ ajustes: ajustesGuardados });
    const guardarConfigFn = vi
      .fn()
      .mockResolvedValue({ guardado: true, ajustes: ajustesGuardados });

    render(
      <PreviewRemotionReal
        {...propsBase()}
        obtenerConfigFn={obtenerConfigFn}
        guardarConfigFn={guardarConfigFn}
      />,
    );

    await waitFor(() => expect(obtenerConfigFn).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('guardar-estilo'));

    await waitFor(() => expect(guardarConfigFn).toHaveBeenCalledTimes(1));
    // El estilo cargado (color #abcdef) se mantiene al persistir.
    const [ajustesEnviados] = guardarConfigFn.mock.calls[0];
    expect(ajustesEnviados.subtitulos.color).toBe('#abcdef');
  });

  it('muestra mensaje de éxito tras guardar (Req 5.3)', async () => {
    const obtenerConfigFn = vi.fn().mockResolvedValue({ ajustes: null });
    const guardarConfigFn = vi
      .fn()
      .mockResolvedValue({ guardado: true, ajustes: AJUSTES_POR_DEFECTO });

    render(
      <PreviewRemotionReal
        {...propsBase()}
        obtenerConfigFn={obtenerConfigFn}
        guardarConfigFn={guardarConfigFn}
      />,
    );

    await waitFor(() => expect(obtenerConfigFn).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId('guardar-estilo'));

    const mensaje = await screen.findByTestId('guardar-mensaje');
    expect(mensaje).toHaveTextContent('Estilo guardado');
    expect(mensaje).toHaveAttribute('role', 'status');
    // Sin error visible.
    expect(screen.queryByTestId('guardar-error')).toBeNull();
  });

  it('en fallo muestra error, no rompe y no invoca onRenderConfirmado (Req 5.4)', async () => {
    const obtenerConfigFn = vi.fn().mockResolvedValue({ ajustes: null });
    const guardarConfigFn = vi
      .fn()
      .mockRejectedValue(new Error('red caída'));
    const onRenderConfirmado = vi.fn();

    render(
      <PreviewRemotionReal
        {...propsBase()}
        obtenerConfigFn={obtenerConfigFn}
        guardarConfigFn={guardarConfigFn}
        onRenderConfirmado={onRenderConfirmado}
      />,
    );

    await waitFor(() => expect(obtenerConfigFn).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId('guardar-estilo'));

    const error = await screen.findByTestId('guardar-error');
    expect(error).toHaveTextContent('No se pudo guardar el estilo');
    expect(error).toHaveAttribute('role', 'alert');
    // El componente sigue montado (no rompe) y NO se altera el estado del Job.
    expect(screen.getByTestId('preview-remotion-real')).toBeInTheDocument();
    expect(onRenderConfirmado).not.toHaveBeenCalled();
    // Sin mensaje de éxito.
    expect(screen.queryByTestId('guardar-mensaje')).toBeNull();
  });
});


describe('PreviewRemotionReal (5.5) — Confirmar y renderizar', () => {
  it('confirma llamando a elegirFn con (jobId, "remotion") e invoca onRenderConfirmado en éxito (Req 6.2, 6.3)', async () => {
    const obtenerConfigFn = vi.fn().mockResolvedValue({ ajustes: null });
    // elegirFn resuelve = el backend respondió 202.
    const elegirFn = vi
      .fn()
      .mockResolvedValue({ job_id: 'job-123', estado: 'en_ejecucion' });
    const onRenderConfirmado = vi.fn();
    const props = propsBase();

    render(
      <PreviewRemotionReal
        {...props}
        obtenerConfigFn={obtenerConfigFn}
        elegirFn={elegirFn}
        onRenderConfirmado={onRenderConfirmado}
      />,
    );

    await waitFor(() => expect(obtenerConfigFn).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('confirmar-render'));

    await waitFor(() => expect(elegirFn).toHaveBeenCalledTimes(1));
    // Se llama con el jobId y el motor "remotion".
    const [jobIdArg, motorArg] = elegirFn.mock.calls[0];
    expect(jobIdArg).toBe(props.jobId);
    expect(motorArg).toBe('remotion');

    // En éxito (202) se notifica al padre.
    await waitFor(() => expect(onRenderConfirmado).toHaveBeenCalledTimes(1));
    // Sin error de render visible.
    expect(screen.queryByTestId('render-error')).toBeNull();
  });

  it('en 409 muestra error de conflicto, NO invoca onRenderConfirmado y no rompe (Req 6.4)', async () => {
    const obtenerConfigFn = vi.fn().mockResolvedValue({ ajustes: null });
    // El backend responde 409 (el Job ya no está esperando la elección).
    const elegirFn = vi
      .fn()
      .mockRejectedValue(
        new ApiError('CONFLICT', 'El Job no está esperando la elección.', 409),
      );
    const onRenderConfirmado = vi.fn();

    render(
      <PreviewRemotionReal
        {...propsBase()}
        obtenerConfigFn={obtenerConfigFn}
        elegirFn={elegirFn}
        onRenderConfirmado={onRenderConfirmado}
      />,
    );

    await waitFor(() => expect(obtenerConfigFn).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('confirmar-render'));

    // Se muestra el error específico de conflicto (role alert), sin romper.
    const error = await screen.findByTestId('render-error');
    expect(error).toHaveAttribute('role', 'alert');
    expect(error).toHaveTextContent('ya no está esperando');
    // NO se invoca onRenderConfirmado.
    expect(onRenderConfirmado).not.toHaveBeenCalled();
    // El componente sigue montado (no rompe la UI).
    expect(screen.getByTestId('preview-remotion-real')).toBeInTheDocument();
  });

  it('en error genérico (no 409) muestra mensaje genérico y no invoca onRenderConfirmado', async () => {
    const obtenerConfigFn = vi.fn().mockResolvedValue({ ajustes: null });
    const elegirFn = vi.fn().mockRejectedValue(new Error('red caída'));
    const onRenderConfirmado = vi.fn();

    render(
      <PreviewRemotionReal
        {...propsBase()}
        obtenerConfigFn={obtenerConfigFn}
        elegirFn={elegirFn}
        onRenderConfirmado={onRenderConfirmado}
      />,
    );

    await waitFor(() => expect(obtenerConfigFn).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('confirmar-render'));

    const error = await screen.findByTestId('render-error');
    expect(error).toHaveTextContent('No se pudo confirmar el render');
    expect(onRenderConfirmado).not.toHaveBeenCalled();
    expect(screen.getByTestId('preview-remotion-real')).toBeInTheDocument();
  });
});


describe('PreviewRemotionReal (5.6) — manejo de errores de carga del vídeo', () => {
  it('si el Player lanza, muestra video-error y NO rompe el resto de la UI (Req 9.4)', async () => {
    // Simula un fallo de carga/reproducción del vídeo: el mock del Player lanza.
    estadoPlayerMock.lanzar = true;
    // Silenciamos console.error: React registra el error capturado por el
    // boundary y el propio boundary lo registra; no queremos ruido en el log.
    const spyError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const obtenerConfigFn = vi.fn().mockResolvedValue({ ajustes: null });

    render(
      <PreviewRemotionReal {...propsBase()} obtenerConfigFn={obtenerConfigFn} />,
    );

    // El Error Boundary captura el fallo y muestra el aviso discreto.
    const aviso = await screen.findByTestId('video-error');
    expect(aviso).toBeInTheDocument();
    // El Player (mock) no llegó a montarse.
    expect(screen.queryByTestId('player-mock')).toBeNull();

    // El resto de la UI permanece intacta y operativa (Req 9.4):
    expect(screen.getByTestId('preview-remotion-real')).toBeInTheDocument();
    expect(screen.getByTestId('panel-estilo')).toBeInTheDocument();
    expect(screen.getByTestId('confirmar-render')).toBeInTheDocument();
    expect(screen.getByTestId('guardar-estilo')).toBeInTheDocument();

    // El error se registró para diagnóstico (Req 9.1).
    expect(spyError).toHaveBeenCalled();
    spyError.mockRestore();
  });

  it('un fallo de carga del vídeo NO deshabilita "Confirmar y renderizar" (Req 9.1)', async () => {
    estadoPlayerMock.lanzar = true;
    const spyError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const obtenerConfigFn = vi.fn().mockResolvedValue({ ajustes: null });
    const elegirFn = vi
      .fn()
      .mockResolvedValue({ job_id: 'job-123', estado: 'en_ejecucion' });
    const onRenderConfirmado = vi.fn();
    const props = propsBase();

    render(
      <PreviewRemotionReal
        {...props}
        obtenerConfigFn={obtenerConfigFn}
        elegirFn={elegirFn}
        onRenderConfirmado={onRenderConfirmado}
      />,
    );

    // Aunque el vídeo falla, el botón de confirmar sigue habilitado y operativo.
    const confirmar = await screen.findByTestId('confirmar-render');
    expect(confirmar).not.toBeDisabled();

    fireEvent.click(confirmar);

    // La confirmación funciona pese al fallo del vídeo: se dispara el render.
    await waitFor(() => expect(elegirFn).toHaveBeenCalledTimes(1));
    const [jobIdArg, motorArg] = elegirFn.mock.calls[0];
    expect(jobIdArg).toBe(props.jobId);
    expect(motorArg).toBe('remotion');
    await waitFor(() => expect(onRenderConfirmado).toHaveBeenCalledTimes(1));

    // El aviso del vídeo sigue visible; el editor no se rompió.
    expect(screen.getByTestId('video-error')).toBeInTheDocument();
    spyError.mockRestore();
  });
});


describe('PreviewRemotionReal (7.1) — consolidación: mapeo a lib/api (HTTP)', () => {
  // Consolidación de la tarea 7.1. Los tests de 5.4/5.5 ya prueban que
  // "Guardar estilo" invoca `guardarConfigFn` y que "Confirmar" invoca
  // `elegirFn` con `remotion` a nivel de función inyectada. Aquí cerramos el
  // mapeo con el CRITERIO DE ACEPTACIÓN a nivel de transporte: usamos las
  // funciones POR DEFECTO de `lib/api` (sin inyección) y mockeamos su `fetch`
  // para aseverar que:
  //   - "Guardar estilo"  => PUT  /configuracion       (Req 5.2)
  //   - "Confirmar"       => POST /render/{id} {motor}  (Req 6.2)
  //
  // Así se demuestra que `guardarConfiguracion` corresponde al `PUT` y que
  // `elegirRender` corresponde al `POST /render` con `motor: "remotion"`.

  /** Construye una `Response` mínima compatible con `parseJsonOrThrow`. */
  function respuestaJson(cuerpo: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(cuerpo),
    } as unknown as Response;
  }

  /** `fetch` mockeado que enruta por método + ruta del backend. */
  const fetchMock = vi.fn(
    (url: string | URL, init?: RequestInit): Promise<Response> => {
      const u = String(url);
      const metodo = (init?.method ?? 'GET').toUpperCase();
      // Carga inicial del estilo al montar: GET /configuracion (sin config).
      if (u.includes('/configuracion') && metodo === 'GET') {
        return Promise.resolve(respuestaJson({ ajustes: null }));
      }
      // Guardar estilo: PUT /configuracion.
      if (u.includes('/configuracion') && metodo === 'PUT') {
        return Promise.resolve(
          respuestaJson({ guardado: true, ajustes: AJUSTES_POR_DEFECTO }),
        );
      }
      // Confirmar y renderizar: POST /render/{id}.
      if (u.includes('/render/') && metodo === 'POST') {
        return Promise.resolve(
          respuestaJson({ job_id: 'job-123', estado: 'en_ejecucion' }),
        );
      }
      // Cualquier otra ruta no esperada en estos tests.
      return Promise.resolve(respuestaJson({}, 200));
    },
  );

  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("'Guardar estilo' llama al backend con PUT /configuracion (Req 5.2)", async () => {
    // Sin inyectar guardarConfigFn/obtenerConfigFn: se usan las funciones reales
    // de `lib/api`, cuyo transporte (`fetch`) está mockeado.
    render(<PreviewRemotionReal {...propsBase()} />);

    // Espera a que la carga inicial (GET /configuracion) se complete.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u, i]) =>
            String(u).includes('/configuracion') &&
            (i?.method ?? 'GET').toUpperCase() === 'GET',
        ),
      ).toBe(true),
    );

    // Cambiamos el estilo para que el cuerpo del PUT lo refleje.
    fireEvent.change(screen.getByTestId('estilo-tamano'), {
      target: { value: '142' },
    });

    fireEvent.click(screen.getByTestId('guardar-estilo'));

    // Debe realizarse un PUT contra /configuracion.
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        ([u, i]) =>
          String(u).includes('/configuracion') &&
          (i?.method ?? 'GET').toUpperCase() === 'PUT',
      );
      expect(put).toBeDefined();
    });

    const put = fetchMock.mock.calls.find(
      ([u, i]) =>
        String(u).includes('/configuracion') &&
        (i?.method ?? 'GET').toUpperCase() === 'PUT',
    )!;
    const [, init] = put;
    // El cuerpo del PUT incluye los ajustes con el estilo actual (tamano=142),
    // demostrando que guardarConfiguracion => PUT /configuracion con el estilo.
    const cuerpo = JSON.parse(String(init?.body));
    expect(cuerpo.ajustes.subtitulos.tamano).toBe(142);

    // Mensaje de éxito visible (Req 5.3) sin error.
    expect(await screen.findByTestId('guardar-mensaje')).toBeInTheDocument();
    expect(screen.queryByTestId('guardar-error')).toBeNull();
  });

  it("'Confirmar y renderizar' llama al backend con POST /render y motor 'remotion' (Req 6.2)", async () => {
    const onRenderConfirmado = vi.fn();
    const props = propsBase();
    render(
      <PreviewRemotionReal
        {...props}
        onRenderConfirmado={onRenderConfirmado}
      />,
    );

    // Espera la carga inicial para partir de un estado estable.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u]) =>
          String(u).includes('/configuracion'),
        ),
      ).toBe(true),
    );

    fireEvent.click(screen.getByTestId('confirmar-render'));

    // Debe realizarse un POST contra /render/{jobId}.
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([u, i]) =>
          String(u).includes('/render/') &&
          (i?.method ?? 'GET').toUpperCase() === 'POST',
      );
      expect(post).toBeDefined();
    });

    const post = fetchMock.mock.calls.find(
      ([u, i]) =>
        String(u).includes('/render/') &&
        (i?.method ?? 'GET').toUpperCase() === 'POST',
    )!;
    const [url, init] = post;
    // La URL apunta al Job y el cuerpo lleva el motor "remotion" (Req 6.2),
    // demostrando que elegirRender => POST /render/{id} con { motor: "remotion" }.
    expect(String(url)).toContain(`/render/${props.jobId}`);
    const cuerpo = JSON.parse(String(init?.body));
    expect(cuerpo.motor).toBe('remotion');

    // En éxito (202) se notifica al padre (Req 6.3) sin error de render.
    await waitFor(() => expect(onRenderConfirmado).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('render-error')).toBeNull();
  });
});
