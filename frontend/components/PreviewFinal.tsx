'use client';

/**
 * Componente `PreviewFinal` — pantalla de EDICIÓN FINAL del vídeo
 * (estado `esperando_edicion_final`, design §3.2 «PreviewFinal.tsx» y §8.2).
 *
 * Es la evolución de `PreviewRemotionReal.tsx` para la etapa final del flujo
 * `edicion-avanzada-shorts`: se muestra DESPUÉS de que el vídeo ya está
 * producido/recortado y los subtítulos ya están confirmados. Sobre ese vídeo ya
 * cortado ofrece:
 *
 *   1. PREVIEW EN VIVO con `@remotion/player`: reproduce el vídeo cortado con
 *      los subtítulos confirmados mapeados a milisegundos (Req 8.3, 18.1).
 *   2. GESTIÓN DE TEXTOS EXTRA tipo «hook» (hasta 2, in/out en segundos, estilo
 *      independiente) montando el componente controlado `TextosExtra` —que ya
 *      expone el botón «Agregar texto»— y guardando su lista como fuente de
 *      verdad (Req 9.1–9.6). Los textos extra se INYECTAN en los `inputProps`
 *      de la composición (mapeados con `textosExtraBackendARemotion`) para que
 *      se vean en la preview únicamente entre su in/out (Req 8.4, 10.1).
 *   3. CONFIRMAR Y RENDERIZAR: botón que envía los textos extra al backend con
 *      `confirmarRenderFinal(jobId, textosExtra)` y, en éxito (202), invoca el
 *      callback de continuación `onRenderConfirmado` para que el orquestador
 *      siga el progreso del render. El botón se DESHABILITA mientras algún texto
 *      extra tenga un rango inválido (se escucha `onValidezChange` de
 *      `TextosExtra`, Req 9.6).
 *
 * ELIMINACIÓN DE LA ELECCIÓN DE MOTOR (Req 11.1): a diferencia de
 * `EleccionRender`/`PreviewRemotionReal`, esta pantalla NO ofrece ningún control
 * para elegir motor (ass/remotion). El render es SIEMPRE Remotion: por eso se
 * usa `confirmarRenderFinal` (que NO envía `motor`; el backend usa `"remotion"`
 * por defecto) en lugar de `elegirRender`.
 *
 * INTEGRACIÓN CON `page.tsx` (tarea 10.8): la orquestación final montará este
 * componente cuando el Job esté en `esperando_edicion_final`, alimentándolo con
 * los datos de `GET /render/{jobId}` (grupos, `video_url`, `ancho`, `alto`,
 * `fps`, `duracion_s` y `textos_extra` ya persistidos). El callback
 * `onRenderConfirmado` se cableará para pasar a la vista de progreso del render.
 * Aquí nos centramos SOLO en el componente; `page.tsx` no se toca en esta tarea.
 *
 * Se REUTILIZA el patrón de Error Boundary de la preview existente
 * (`LimiteErrorVideo`) para AISLAR los fallos de carga/reproducción del vídeo de
 * fondo sin romper el resto del editor ni bloquear la confirmación.
 *
 * `PreviewRemotionReal.tsx` se conserva INTACTO (lo usa `EleccionRender` en el
 * flujo antiguo de elección de motor y tiene tests propios); este componente es
 * nuevo y no lo reemplaza.
 *
 * Requisitos: 8.3, 8.4, 10.1, 11.1, 18.1.
 */

import { Component, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Player } from '@remotion/player';

import TextosExtra from '@/components/TextosExtra';
import { ShortVideo } from '@/components/remotion/ShortVideo';
import type { Estilo, ShortVideoProps } from '@/components/remotion/types';
import type { GrupoSubtituloConPalabras, TextoExtra } from '@/lib/types';
import { ApiError, confirmarRenderFinal, obtenerConfiguracion } from '@/lib/api';
import { AJUSTES_POR_DEFECTO } from '@/lib/defaults';
import { estiloDesdeAjustes } from '@/lib/estilo';
import {
  calcularDurationInFrames,
  gruposBackendARemotion,
  textosExtraBackendARemotion,
} from '@/lib/remotion-map';

/**
 * Alto en píxeles al que se escala el lienzo 9:16 dentro del Player (igual que
 * la preview existente: ~640px de alto). El ancho se calcula manteniendo la
 * proporción real del vídeo (`width/height`) para no deformar la imagen.
 */
const ALTO_PREVIEW_PX = 640;

/**
 * Estilo de subtítulo por defecto, derivado de `AJUSTES_POR_DEFECTO.subtitulos`
 * con la misma proyección centralizada (`estiloDesdeAjustes`) que la preview
 * existente. Es el estilo con el que se muestran los subtítulos mientras se
 * resuelve la carga de la configuración guardada. En la etapa final los
 * subtítulos son de SOLO LECTURA (ya confirmados): aquí solo se usa para que la
 * preview los pinte con el estilo vigente.
 */
export const ESTILO_SUBTITULOS_POR_DEFECTO: Estilo = estiloDesdeAjustes(
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
 * render del vídeo de fondo (mismo patrón que la preview existente).
 *
 * Envuelve SOLO el `<Player>`/composición. Si el Player o la composición lanzan
 * durante el render (p. ej. el navegador no puede reproducir el MP4 por códec o
 * red), este boundary captura el error para que NO se propague y rompa el resto
 * del editor. En ese caso muestra un aviso discreto
 * (`data-testid="video-error"`) en lugar del vídeo, mientras el resto de la UI
 * (panel de textos extra y «Confirmar y renderizar») permanece operativa; en
 * particular, un fallo de carga del vídeo NO impide confirmar el render.
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

  /** Registra el error de carga/render del vídeo para diagnóstico. */
  componentDidCatch(error: unknown): void {
    // Se registra sin propagar: el fallo del vídeo queda contenido aquí.
    console.error(
      'Error al cargar/reproducir el vídeo de fondo en la edición final:',
      error,
    );
  }

  render(): ReactNode {
    if (this.state.huboError) {
      // Fallback discreto: el vídeo no se pudo cargar, pero la edición de textos
      // extra y el render siguen disponibles. NO bloquea la confirmación.
      return (
        <div
          data-testid="video-error"
          role="alert"
          className="flex items-center justify-center rounded bg-black/60 p-4 text-center text-sm text-yellow-300"
        >
          No se pudo cargar el vídeo de fondo; los subtítulos, los textos extra y
          el render siguen disponibles.
        </div>
      );
    }
    return this.props.children;
  }
}

/** Props de `PreviewFinal` (etapa `esperando_edicion_final`). */
export interface PreviewFinalProps {
  /** Id del Job pausado en `esperando_edicion_final`. */
  jobId: string;
  /** Grupos reales de subtítulo (segundos), incluyendo palabras con timing. */
  grupos: GrupoSubtituloConPalabras[];
  /** URL HTTP del vídeo de fondo YA cortado (`GET /workfile/{id}/{nombre}`). */
  videoUrl: string;
  /** Ancho del render en píxeles (para dimensionar el Player). */
  width: number;
  /** Alto del render en píxeles. */
  height: number;
  /** Cuadros por segundo del render. */
  fps: number;
  /** Duración del vídeo cortado en segundos (para `durationInFrames` y validación). */
  duracionS: number;
  /**
   * Textos extra ya persistidos (últimos enviados) con los que inicializar el
   * panel; por defecto lista vacía (Req 8.2). Provienen de
   * `GET /render/{jobId}.textos_extra`.
   */
  textosExtraIniciales?: TextoExtra[];
  /** URL base del backend (inyectable en tests). */
  baseUrl?: string;
  /**
   * Se invoca cuando el render final se confirma correctamente (202): el
   * orquestador (`page.tsx`, tarea 10.8) lo usa para pasar a seguir el progreso.
   */
  onRenderConfirmado?: () => void;
  // --- Inyecciones opcionales para tests ---
  /** Reemplazo de `obtenerConfiguracion` (carga inicial del estilo de subtítulos). */
  obtenerConfigFn?: typeof obtenerConfiguracion;
  /** Reemplazo de `confirmarRenderFinal` (confirmación del render final). */
  confirmarRenderFinalFn?: typeof confirmarRenderFinal;
}

/**
 * Pantalla de edición final: preview en vivo (vídeo cortado + subtítulos +
 * textos extra) y confirmación del render (siempre Remotion).
 */
export default function PreviewFinal({
  jobId,
  grupos,
  videoUrl,
  width,
  height,
  fps,
  duracionS,
  textosExtraIniciales,
  baseUrl,
  onRenderConfirmado,
  obtenerConfigFn = obtenerConfiguracion,
  confirmarRenderFinalFn = confirmarRenderFinal,
}: PreviewFinalProps) {
  // Estilo de subtítulos SOLO para pintar la preview (los subtítulos ya están
  // confirmados; aquí no se editan). Arranca por defecto y se sobreescribe con
  // el estilo guardado si la carga inicial lo encuentra.
  const [estilo, setEstilo] = useState<Estilo>(ESTILO_SUBTITULOS_POR_DEFECTO);

  // FUENTE DE VERDAD de los textos extra (0..2). `TextosExtra` es controlado:
  // emite la nueva lista por `onChange` en cada edición y aquí se guarda para
  // (a) inyectarla en la preview y (b) enviarla al confirmar. Se inicializa con
  // los textos ya persistidos (o lista vacía).
  const [textosExtra, setTextosExtra] = useState<TextoExtra[]>(
    textosExtraIniciales ?? [],
  );

  // Validez global de los textos extra (Req 9.6). `TextosExtra` la informa por
  // `onValidezChange`; con la lista vacía es `true` (nada que invalidar), por lo
  // que confirmar queda habilitado cuando no hay textos extra.
  const [textosValidos, setTextosValidos] = useState(true);

  // Estado local de la acción «Confirmar y renderizar». `confirmando`
  // deshabilita el botón mientras se dispara el render; `errorRender` muestra el
  // error de confirmación (p. ej. 409) sin romper la interfaz.
  const [confirmando, setConfirmando] = useState(false);
  const [errorRender, setErrorRender] = useState<string | null>(null);

  // Precarga del estilo de subtítulos guardado al montar: si hay
  // `ajustes.subtitulos` en la configuración del backend, inicializa `estilo`
  // con `estiloDesdeAjustes`; si falla o no hay config, se conserva el estilo
  // por defecto. El flag `activo` evita actualizar el estado tras el desmontaje.
  useEffect(() => {
    let activo = true;
    (async () => {
      try {
        const { ajustes } = await obtenerConfigFn({ baseUrl });
        if (!activo || !ajustes?.subtitulos) return;
        setEstilo(estiloDesdeAjustes(ajustes.subtitulos));
      } catch {
        // Sin config o error de red: se mantiene el estilo por defecto.
      }
    })();
    return () => {
      activo = false;
    };
  }, [obtenerConfigFn, baseUrl]);

  // --- Construcción de las props de la composición (memoizadas) ---
  //
  // Se separan en `useMemo` con dependencias mínimas para que un cambio en los
  // textos extra o el estilo NO altere la referencia de `gruposRemotion` ni el
  // valor de `videoSrc`, evitando que el Player recargue el vídeo de fondo.

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

  // 3) Textos extra mapeados al contrato de la composición (camelCase + ms
  //    redondeados con el mismo criterio que el backend). Dep: `textosExtra`.
  //    Esta es la INYECCIÓN que hace que los overlays se vean en la preview
  //    únicamente entre su in/out (Req 8.4, 10.1).
  const textosExtraRemotion = useMemo(
    () => textosExtraBackendARemotion(textosExtra),
    [textosExtra],
  );

  // 4) Props de entrada de la composición. `videoSrc = videoUrl` (no vacío) hace
  //    que ShortVideo muestre el vídeo REAL cortado de fondo. `textosExtra` se
  //    inyecta aquí: al editar un texto (o su in/out), cambia esta referencia y
  //    la capa de textos extra se re-renderiza, pero `videoSrc` y
  //    `gruposRemotion` NO cambian, así que el vídeo no se recarga.
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
      textosExtra: textosExtraRemotion,
    }),
    [
      videoUrl,
      fps,
      width,
      height,
      durationInFrames,
      estilo,
      gruposRemotion,
      textosExtraRemotion,
    ],
  );

  // Dimensiones del lienzo escaladas manteniendo la proporción real del vídeo
  // (p. ej. 1080x1920 → 360x640). Se protege de dimensiones no válidas.
  const anchoPreviewPx = useMemo(() => {
    if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0) {
      return Math.round((ALTO_PREVIEW_PX * 9) / 16);
    }
    return Math.round((ALTO_PREVIEW_PX * width) / height);
  }, [width, height]);

  // Recibe la validez global desde `TextosExtra`. Se memoiza para no forzar el
  // efecto interno de `TextosExtra` en cada render de este componente.
  const alCambiarValidez = useCallback((todosValidos: boolean) => {
    setTextosValidos(todosValidos);
  }, []);

  /**
   * Confirma la edición final y dispara el render REAL de Remotion (Req 10.1,
   * 11.1).
   *
   * Flujo:
   *   1. Marca `confirmando` y limpia cualquier `errorRender` previo.
   *   2. Envía los textos extra con `confirmarRenderFinalFn` (`POST /render/{id}`
   *      con `{ textos_extra: [...] }`, SIN campo `motor`: el backend usa
   *      `"remotion"` por defecto).
   *   3. En éxito (202), invoca `onRenderConfirmado?.()` para que el orquestador
   *      pase a seguir el progreso del render.
   *   4. En error, NO rompe la UI:
   *        - `ApiError` con `status === 409` (el Job ya no está en
   *          `esperando_edicion_final`): mensaje específico de conflicto.
   *        - Cualquier otro error: mensaje genérico.
   *
   * Guarda de seguridad: si algún texto extra es inválido, no envía nada (el
   * botón ya está deshabilitado, pero se comprueba también aquí, Req 9.6).
   */
  async function confirmarRender(): Promise<void> {
    if (!textosValidos || confirmando) return;
    setConfirmando(true);
    setErrorRender(null);
    try {
      await confirmarRenderFinalFn(jobId, textosExtra, { baseUrl });
      // 202: los textos extra se persistieron y el render reanuda con Remotion.
      onRenderConfirmado?.();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // El Job ya salió de `esperando_edicion_final` (p. ej. render iniciado
        // en otra pestaña). Se informa sin romper la UI.
        setErrorRender(
          'El Job ya no está esperando la edición final; el render ya se inició. Continúa siguiendo el progreso.',
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
      data-testid="preview-final"
    >
      <div>
        <h3 className="text-lg font-medium text-white">Edición final</h3>
        <p className="mt-1 text-sm text-gray-400">
          Vista en vivo del vídeo cortado con los subtítulos confirmados. Añade
          hasta 2 textos extra y confirma para renderizar con Remotion.
        </p>
      </div>

      {/*
        Player de @remotion/player con la composición ShortVideo y el vídeo REAL
        cortado de fondo (videoSrc = videoUrl). El lienzo 9:16 se escala a ~640px
        de alto manteniendo la proporción.

        Los textos extra van dentro de `inputProps.textosExtra` (mapeados con
        `textosExtraBackendARemotion`): la composición los muestra únicamente
        entre su in/out (Req 8.4, 10.1).

        Manejo de errores de carga del vídeo (Req reutilizado): el Player se
        envuelve en `LimiteErrorVideo` (Error Boundary). Si el Player o la
        composición lanzan, el boundary AÍSLA el fallo y muestra `video-error`
        en su lugar; el panel de textos extra y «Confirmar y renderizar» siguen
        operativos.
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
        Panel de TEXTOS EXTRA (componente controlado). Expone su propio botón
        «Agregar texto» (deshabilitado al llegar a 2) y, por cada texto, el campo
        de texto, los campos in/out en segundos con validación y el panel de
        estilo independiente. `onChange` actualiza la fuente de verdad
        (`textosExtra`), lo que recalcula `textosExtraRemotion` y refresca la
        preview; `onValidezChange` informa la validez para habilitar/inhabilitar
        «Confirmar y renderizar» (Req 9.1–9.6).
      */}
      <TextosExtra
        textos={textosExtra}
        duracionS={duracionS}
        onChange={setTextosExtra}
        onValidezChange={alCambiarValidez}
      />

      {/*
        Acciones de la etapa final. NO hay elección de motor (Req 11.1): el único
        botón de acción es «Confirmar y renderizar», que envía los textos extra
        con `confirmarRenderFinal` y, en éxito, continúa el flujo. Se deshabilita
        mientras se confirma o si algún texto extra es inválido (Req 9.6). El
        error de confirmación (p. ej. 409) se muestra en `render-error` sin
        romper la UI.
      */}
      <div
        className="mt-1 flex items-center gap-3 border-t border-editor-border pt-3"
        data-testid="acciones-final"
      >
        <button
          type="button"
          data-testid="confirmar-render-final"
          onClick={confirmarRender}
          disabled={confirmando || !textosValidos}
          className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
        >
          {confirmando ? 'Confirmando…' : 'Confirmar y renderizar'}
        </button>
        {!textosValidos && (
          <span
            role="note"
            data-testid="confirmar-bloqueado"
            className="text-sm text-yellow-300"
          >
            Corrige los textos extra con rango inválido para poder renderizar.
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
