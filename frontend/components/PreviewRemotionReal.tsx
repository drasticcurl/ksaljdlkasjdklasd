'use client';

/**
 * Componente `PreviewRemotionReal` — previsualización del vídeo REAL con
 * subtítulos reales (Remotion) antes de renderizar.
 *
 * Se monta desde `EleccionRender` cuando el usuario activa el toggle
 * "Previsualizar con vídeo real (Remotion)" y hay `video_url` disponible. Su
 * objetivo final (tareas 5.2–5.6) es:
 *   - Montar `<Player>` de `@remotion/player` con el vídeo real de fondo y los
 *     subtítulos reales mapeados a milisegundos (5.2).
 *   - Ofrecer el panel de estilo reutilizable (`EstiloSubtitulos`) con re-render
 *     en vivo, sin recargar el vídeo (5.3).
 *   - "Guardar estilo" (`PUT /configuracion`) (5.4).
 *   - "Confirmar y renderizar" (`POST /render/{id}` con `motor: "remotion"`) (5.5).
 *   - Manejo de errores de carga del vídeo (5.6).
 *
 * -------------------------------------------------------------------------
 * ALCANCE IMPLEMENTADO HASTA AHORA:
 *   - 5.1: estructura del componente y CARGA INICIAL del estilo desde
 *     `GET /configuracion` (o `ESTILO_POR_DEFECTO`).
 *   - 5.2: montaje del `<Player>` con el vídeo REAL de fondo y los subtítulos
 *     reales mapeados a milisegundos.
 *   - 5.3: panel de estilo (SOLO estilo) con `EstiloSubtitulos` y re-render en
 *     vivo sin recargar el vídeo. El texto de los grupos es de solo lectura
 *     (no se expone ningún control para editarlo).
 *   - 5.4: botón "Guardar estilo": carga la config vigente (o por defecto),
 *     aplica `ajustesConEstilo` y persiste con `PUT /configuracion`; muestra
 *     mensaje de éxito/error. NO altera el estado del Job en caso de fallo.
 *   - 5.5: botón "Confirmar y renderizar": dispara el render REAL de Remotion
 *     (`POST /render/{id}` con `motor: "remotion"` vía `elegirRender`); en éxito
 *     (202) invoca `onRenderConfirmado`; ante `409` (ApiError) muestra un error
 *     de conflicto sin romper la UI; ante otros errores, un mensaje genérico.
 *   - 5.6: manejo de errores de carga del vídeo. El `<Player>` se envuelve en un
 *     React Error Boundary (`LimiteErrorVideo`) que AÍSLA cualquier fallo de
 *     render/reproducción del Player o de la composición para que NO se propague
 *     y rompa el resto del editor (Req 9.4). Si el Player lanza, se muestra un
 *     aviso discreto (`data-testid="video-error"`) y el resto de la UI (panel de
 *     estilo, "Guardar estilo" y "Confirmar y renderizar") sigue operativo; en
 *     particular, un fallo de carga del vídeo NO deshabilita la confirmación
 *     (Req 9.1). El error se registra con `console.error` para diagnóstico.
 * -------------------------------------------------------------------------
 *
 * Requisitos: 4.1, 4.2, 4.3 (ajuste de solo estilo, re-render en vivo sin
 * recargar el vídeo, texto de solo lectura), 4.4 (inicialización del estilo
 * desde la configuración guardada o por defecto), 5.1–5.5 (guardar estilo y
 * confirmar) y 9.1, 9.4 (manejo de errores de carga del vídeo: aislar el fallo
 * del Player sin bloquear la confirmación ni el resto del editor).
 */

import { Component, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Player } from '@remotion/player';

import EstiloSubtitulos from '@/components/EstiloSubtitulos';
import { ShortVideo } from '@/components/remotion/ShortVideo';
import type { Estilo, ShortVideoProps } from '@/components/remotion/types';
import type { GrupoSubtituloConPalabras } from '@/lib/types';
import {
  ApiError,
  elegirRender,
  guardarConfiguracion,
  obtenerConfiguracion,
} from '@/lib/api';
import { AJUSTES_POR_DEFECTO } from '@/lib/defaults';
import { ajustesConEstilo, estiloDesdeAjustes } from '@/lib/estilo';
import {
  calcularDurationInFrames,
  gruposBackendARemotion,
} from '@/lib/remotion-map';

/**
 * Alto en píxeles al que se escala el lienzo 9:16 dentro del Player (igual que
 * el playground: ~640px de alto). El ancho se calcula manteniendo la proporción
 * real del vídeo (`width/height`) para no deformar la imagen.
 */
const ALTO_PREVIEW_PX = 640;

/**
 * Estilo por defecto derivado de `AJUSTES_POR_DEFECTO.subtitulos`, con el mismo
 * criterio que el playground: se reutiliza la proyección centralizada
 * `estiloDesdeAjustes` para no duplicar el mapeo `snake_case → camelCase`.
 *
 * Es el estilo inicial mientras se resuelve la carga de la configuración y el
 * que se conserva si no hay config guardada o falla la petición.
 */
export const ESTILO_POR_DEFECTO: Estilo = estiloDesdeAjustes(
  AJUSTES_POR_DEFECTO.subtitulos,
);

/** Props del límite de error del vídeo (`LimiteErrorVideo`). */
interface LimiteErrorVideoProps {
  /** Contenido normal a renderizar (el `<Player>`). */
  children: ReactNode;
}

/** Estado interno del límite de error del vídeo. */
interface LimiteErrorVideoState {
  /** `true` cuando el subárbol (Player/composición) ha lanzado al renderizar. */
  huboError: boolean;
}

/**
 * `LimiteErrorVideo` — React Error Boundary que AÍSLA los fallos de carga o
 * render del vídeo de fondo (tarea 5.6, Req 9.1 y 9.4).
 *
 * Envuelve SOLO el `<Player>`/composición. Si el Player o la composición lanzan
 * durante el render (p. ej. el navegador no puede reproducir el MP4 por códec o
 * red), este boundary captura el error para que NO se propague y rompa el resto
 * del editor (Req 9.4). En ese caso muestra un aviso discreto
 * (`data-testid="video-error"`) en lugar del vídeo, mientras el resto de la UI
 * (panel de estilo, "Guardar estilo" y "Confirmar y renderizar") permanece
 * intacta y operativa; en particular, un fallo de carga del vídeo NO impide
 * confirmar el render (Req 9.1).
 *
 * El error se registra con `console.error` para diagnóstico. Es un componente
 * de clase porque los Error Boundaries requieren `getDerivedStateFromError` /
 * `componentDidCatch`, que hoy no tienen equivalente en hooks.
 */
class LimiteErrorVideo extends Component<
  LimiteErrorVideoProps,
  LimiteErrorVideoState
> {
  constructor(props: LimiteErrorVideoProps) {
    super(props);
    this.state = { huboError: false };
  }

  /** Ante un error en el subárbol, conmuta a la vista de fallback. */
  static getDerivedStateFromError(): LimiteErrorVideoState {
    return { huboError: true };
  }

  /** Registra el error de carga/render del vídeo para diagnóstico (Req 9.1). */
  componentDidCatch(error: unknown): void {
    // Se registra sin propagar: el fallo del vídeo queda contenido aquí.
    console.error(
      'Error al cargar/reproducir el vídeo de fondo en la previsualización:',
      error,
    );
  }

  render(): ReactNode {
    if (this.state.huboError) {
      // Fallback discreto: el vídeo no se pudo cargar, pero la previsualización
      // (subtítulos) y el render siguen disponibles. NO bloquea la confirmación.
      return (
        <div
          data-testid="video-error"
          role="alert"
          className="flex items-center justify-center rounded bg-black/60 p-4 text-center text-sm text-yellow-300"
        >
          No se pudo cargar el vídeo de fondo; los subtítulos y el render siguen
          disponibles.
        </div>
      );
    }
    return this.props.children;
  }
}

/** Props de `PreviewRemotionReal` (contrato del diseño, "Componente 1"). */
export interface PreviewRemotionRealProps {
  /** Id del Job pausado en `esperando_eleccion_render`. */
  jobId: string;
  /** Grupos reales de subtítulo (segundos), incluyendo palabras con timing. */
  grupos: GrupoSubtituloConPalabras[];
  /** URL HTTP del vídeo de fondo ya cortado (`GET /workfile/{id}/{nombre}`). */
  videoUrl: string;
  /** Ancho del render en píxeles (para dimensionar el Player). */
  width: number;
  /** Alto del render en píxeles. */
  height: number;
  /** Cuadros por segundo del render. */
  fps: number;
  /** Duración del vídeo en segundos (para `durationInFrames`). */
  duracionS: number;
  /** URL base del backend (inyectable en tests). */
  baseUrl?: string;
  /** Se invoca cuando el render se confirma correctamente (reanudación). */
  onRenderConfirmado?: () => void;
  // --- Inyecciones opcionales para tests ---
  /** Reemplazo de `obtenerConfiguracion` (carga inicial del estilo). */
  obtenerConfigFn?: typeof obtenerConfiguracion;
  /** Reemplazo de `guardarConfiguracion` (usado en 5.4). */
  guardarConfigFn?: typeof guardarConfiguracion;
  /** Reemplazo de `elegirRender` (usado en 5.5). */
  elegirFn?: typeof elegirRender;
}

/**
 * Previsualización del vídeo real con subtítulos. En esta tarea (5.1) solo se
 * implementa la estructura y la carga inicial del estilo; el resto es esqueleto.
 */
export default function PreviewRemotionReal({
  jobId,
  grupos,
  videoUrl,
  width,
  height,
  fps,
  duracionS,
  baseUrl,
  onRenderConfirmado,
  obtenerConfigFn = obtenerConfiguracion,
  guardarConfigFn = guardarConfiguracion,
  elegirFn = elegirRender,
}: PreviewRemotionRealProps) {
  // Estilo editable en vivo. Arranca con el estilo por defecto y se sobreescribe
  // con el estilo guardado si la carga inicial lo encuentra.
  const [estilo, setEstilo] = useState<Estilo>(ESTILO_POR_DEFECTO);

  // Estado local del botón "Guardar estilo" (tarea 5.4). Es estado de UI puro:
  // NO altera el estado del Job (Req 5.4). `guardando` deshabilita el botón
  // mientras se persiste; `mensaje`/`error` muestran el resultado.
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Estado local de la acción "Confirmar y renderizar" (tarea 5.5). Es estado de
  // UI independiente del de "Guardar estilo" para NO mezclar mensajes: `confirmando`
  // deshabilita el botón mientras se dispara el render; `errorRender` muestra el
  // error de confirmación (p. ej. 409) sin romper la interfaz (Req 6.4).
  const [confirmando, setConfirmando] = useState(false);
  const [errorRender, setErrorRender] = useState<string | null>(null);

  // Precarga del estilo guardado al montar (Req 4.4): si hay
  // `ajustes.subtitulos` en la configuración del backend, inicializa `estilo`
  // con `estiloDesdeAjustes`; si falla o no hay config, se conserva
  // `ESTILO_POR_DEFECTO`. Se usa el flag `activo` para evitar actualizar el
  // estado tras el desmontaje (mismo patrón que el playground).
  useEffect(() => {
    let activo = true;
    (async () => {
      try {
        const { ajustes } = await obtenerConfigFn({ baseUrl });
        if (!activo || !ajustes?.subtitulos) return;
        setEstilo(estiloDesdeAjustes(ajustes.subtitulos));
      } catch {
        // Sin config o error de red: se mantiene ESTILO_POR_DEFECTO.
      }
    })();
    return () => {
      activo = false;
    };
  }, [obtenerConfigFn, baseUrl]);

  // --- Construcción de las props de la composición (memoizadas) ---
  //
  // Se separan en TRES `useMemo` con dependencias mínimas para que un cambio de
  // SOLO el estilo (5.3) no altere la referencia de `gruposRemotion` ni el valor
  // de `videoSrc`, evitando así que el Player recargue el vídeo de fondo
  // (Req 4.2; se afina en 5.3):
  //
  //   1) `gruposRemotion`: mapeo puro segundos→ms de los grupos del backend
  //      (karaoke por palabra). Solo cambia si cambia `grupos`.
  //   2) `durationInFrames`: duración total en frames. Solo cambia si cambian
  //      `duracionS`, `fps` o `gruposRemotion` (fallback al mayor `endMs`).
  //   3) `inputProps`: props finales de `ShortVideo`. Al depender de `estilo`,
  //      cambiar el estilo genera un nuevo objeto, pero `videoSrc` (=`videoUrl`)
  //      y `grupos` (=`gruposRemotion`, misma referencia) NO cambian, por lo que
  //      el vídeo no se vuelve a cargar.

  // 1) Grupos mapeados al contrato de Remotion (ms). Dep: solo `grupos`.
  const gruposRemotion = useMemo(
    () => gruposBackendARemotion(grupos),
    [grupos],
  );

  // 2) Duración de la composición en frames. Deps: duración, fps y grupos.
  const durationInFrames = useMemo(
    () => calcularDurationInFrames(duracionS, fps, gruposRemotion),
    [duracionS, fps, gruposRemotion],
  );

  // 3) Props de entrada de la composición. `videoSrc = videoUrl` (no vacío) hace
  //    que ShortVideo muestre el vídeo REAL de fondo (Req 3.1). El resto son los
  //    tiempos/estilo/dimensiones reales del render.
  const inputProps: ShortVideoProps = useMemo(
    () => ({
      videoSrc: videoUrl,
      fps,
      width,
      height,
      durationInFrames,
      estilo,
      combineTokensWithinMs: AJUSTES_POR_DEFECTO.render.combine_tokens_ms,
      grupos: gruposRemotion,
    }),
    [videoUrl, fps, width, height, durationInFrames, estilo, gruposRemotion],
  );

  // Dimensiones del lienzo escaladas manteniendo la proporción real del vídeo
  // (p. ej. 1080x1920 → 360x640). Se protege de dimensiones no válidas.
  const anchoPreviewPx = useMemo(() => {
    if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0) {
      return Math.round((ALTO_PREVIEW_PX * 9) / 16);
    }
    return Math.round((ALTO_PREVIEW_PX * width) / height);
  }, [width, height]);

  /**
   * Guarda el estilo actual en la configuración del backend (tarea 5.4).
   *
   * Sigue el mismo criterio que `guardarEstilo` del playground, pero usando la
   * utilidad centralizada `ajustesConEstilo`:
   *   1. Carga la configuración vigente (`obtenerConfigFn`); si no hay ajustes
   *      guardados, parte de `AJUSTES_POR_DEFECTO`.
   *   2. Aplica los campos de estilo actuales sobre `ajustes.subtitulos` con
   *      `ajustesConEstilo(base, estilo)` (proyección inmutable).
   *   3. Persiste con `guardarConfigFn` (`PUT /configuracion`).
   *
   * En éxito informa al usuario (Req 5.3); en error muestra el mensaje y
   * conserva el estilo en memoria (Req 5.4). Es estado de UI puro: NUNCA altera
   * el estado del Job (no llama a `elegirRender` ni notifica al padre).
   */
  async function guardarEstilo(): Promise<void> {
    setGuardando(true);
    setMensaje(null);
    setError(null);
    try {
      const { ajustes: guardados } = await obtenerConfigFn({ baseUrl });
      const base = guardados ?? AJUSTES_POR_DEFECTO;
      await guardarConfigFn(ajustesConEstilo(base, estilo), { baseUrl });
      setMensaje('Estilo guardado. Se usará en el render real.');
    } catch (e) {
      setError(
        e instanceof Error
          ? `No se pudo guardar el estilo: ${e.message}`
          : 'No se pudo guardar el estilo.',
      );
    } finally {
      setGuardando(false);
    }
  }

  /**
   * Confirma y dispara el render REAL de Remotion (tarea 5.5).
   *
   * Flujo (Req 6.1–6.5):
   *   1. Marca `confirmando` y limpia cualquier `errorRender` previo.
   *   2. Llama a `elegirFn` (`POST /render/{jobId}` con `{ motor: "remotion" }`).
   *   3. En éxito (la promesa resuelve; el backend respondió `202`), invoca
   *      `onRenderConfirmado?.()` para que el padre siga el progreso del Job
   *      (equivalente a elegir "Remotion") (Req 6.3).
   *   4. En error, NO rompe la UI (Req 6.4):
   *        - Si es un `ApiError` con `status === 409` (el Job ya no está en
   *          `esperando_eleccion_render`), muestra un mensaje específico de
   *          conflicto.
   *        - Para cualquier otro error, muestra un mensaje genérico.
   *      En ambos casos NO se invoca `onRenderConfirmado`.
   *
   * El estilo con el que se renderiza es el previamente persistido mediante
   * "Guardar estilo" (Req 6.5); esta acción no vuelve a guardarlo.
   */
  async function confirmarRender(): Promise<void> {
    setConfirmando(true);
    setErrorRender(null);
    try {
      await elegirFn(jobId, 'remotion', { baseUrl });
      // 202: la elección se aceptó y el pipeline reanuda con motor=remotion.
      onRenderConfirmado?.();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // El Job ya salió de `esperando_eleccion_render` (p. ej. render iniciado
        // en otra pestaña). Se informa sin romper la UI (Req 6.4).
        setErrorRender(
          'El Job ya no está esperando la elección de motor; el render ya se inició. Continúa siguiendo el progreso.',
        );
      } else {
        setErrorRender(
          e instanceof Error
            ? `No se pudo confirmar el render: ${e.message}`
            : 'No se pudo confirmar el render.',
        );
      }
    } finally {
      setConfirmando(false);
    }
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-editor-border bg-editor-panel p-4"
      data-testid="preview-remotion-real"
    >
      <div>
        <h3 className="text-lg font-medium text-white">
          Previsualización con vídeo real (Remotion)
        </h3>
        <p className="mt-1 text-sm text-gray-400">
          Vista en vivo del vídeo cortado con los subtítulos reales. Solo puedes
          ajustar el estilo (no el texto).
        </p>
      </div>

      {/*
        Player de @remotion/player con la composición ShortVideo y el vídeo REAL
        de fondo (videoSrc = videoUrl). El lienzo 9:16 se escala a ~640px de alto
        manteniendo la proporción, igual que el playground.

        Manejo de errores de carga del vídeo (tarea 5.6, Req 9.1/9.4): el Player
        se envuelve en `LimiteErrorVideo` (Error Boundary). Si el Player o la
        composición lanzan al renderizar/reproducir (p. ej. códec/red), el
        boundary captura el fallo, lo AÍSLA (no rompe el resto del editor) y
        muestra `video-error` en su lugar; el panel de estilo y los botones
        (incl. "Confirmar y renderizar") siguen operativos.
      */}
      <div data-testid="player-wrapper" className="self-center">
        <LimiteErrorVideo>
          <Player
            component={ShortVideo}
            inputProps={inputProps}
            durationInFrames={durationInFrames}
            compositionWidth={width}
            compositionHeight={height}
            fps={fps}
            controls
            loop
            style={{ width: anchoPreviewPx, height: ALTO_PREVIEW_PX }}
          />
        </LimiteErrorVideo>
      </div>

      {/*
        Panel de estilo (SOLO estilo) — tarea 5.3.

        Se integra el componente controlado `EstiloSubtitulos` cableado al estado
        `estilo`/`setEstilo`. Al cambiar cualquier control, `onChange` actualiza
        `estilo`, lo que recalcula únicamente `inputProps` (que depende de
        `estilo`) SIN alterar `videoSrc` (=`videoUrl`) ni la referencia de
        `gruposRemotion`; por eso el Player re-renderiza la capa de subtítulos con
        el nuevo estilo pero NO recarga el vídeo de fondo (Req 4.2).

        IMPORTANTE (Req 4.3): este panel expone SOLO controles de estilo. No hay
        ningún input para editar el texto de los grupos: el texto es de solo
        lectura en esta vista.
      */}
      <div data-testid="panel-estilo">
        <EstiloSubtitulos estilo={estilo} onChange={setEstilo} />
      </div>

      {/*
        Botón "Guardar estilo" (tarea 5.4). Persiste el estilo actual en
        `PUT /configuracion` (mismo patrón que el playground) para que el render
        real lo reutilice (Req 5.1, 5.2, 5.3). El mensaje de éxito (role status)
        y el de error (role alert) usan los mismos `data-testid` que el
        playground. NO altera el estado del Job en caso de fallo (Req 5.4).

        Botón "Confirmar y renderizar" (tarea 5.5): dispara el render REAL de
        Remotion (`POST /render/{id}` con `motor: "remotion"`) y, en éxito (202),
        invoca `onRenderConfirmado` (Req 6.1–6.3). El error de confirmación
        (p. ej. 409) se muestra en `render-error` (role alert) SIN romper la UI
        (Req 6.4), con estado independiente del de "Guardar estilo".

        El manejo de errores de carga del vídeo (5.6) vive alrededor del
        `<Player>` (ver `LimiteErrorVideo` más arriba): un fallo del vídeo NO
        deshabilita estos botones, por lo que "Confirmar y renderizar" sigue
        operativo aunque el vídeo de fondo no cargue (Req 9.1).
      */}
      <div
        className="mt-1 flex items-center gap-3 border-t border-editor-border pt-3"
        data-testid="acciones-preview"
      >
        <button
          type="button"
          data-testid="guardar-estilo"
          onClick={guardarEstilo}
          disabled={guardando}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {guardando ? 'Guardando…' : 'Guardar estilo'}
        </button>
        <button
          type="button"
          data-testid="confirmar-render"
          onClick={confirmarRender}
          disabled={confirmando}
          className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
        >
          {confirmando ? 'Confirmando…' : 'Confirmar y renderizar'}
        </button>
        {mensaje && (
          <span
            role="status"
            data-testid="guardar-mensaje"
            className="text-sm text-green-400"
          >
            {mensaje}
          </span>
        )}
        {error && (
          <span
            role="alert"
            data-testid="guardar-error"
            className="text-sm text-red-400"
          >
            {error}
          </span>
        )}
        {errorRender && (
          <span
            role="alert"
            data-testid="render-error"
            className="text-sm text-red-400"
          >
            {errorRender}
          </span>
        )}
      </div>
    </div>
  );
}
