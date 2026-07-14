'use client';

/**
 * TimelineSilencios — Línea de tiempo tipo "CapCut web" para editar a mano los
 * tramos de silencio (a BORRAR) detectados sobre el vídeo UNIDO (pre-corte).
 *
 * Se muestra cuando un Job está en estado `esperando_edicion_silencios`
 * (spec `edicion-avanzada-shorts`, design §3.2 y §7.1). Su flujo es:
 *   1. Cargar los datos con `obtenerSilencios(jobId)` (`GET /silencios/{id}`):
 *      tramos detectados, duración total del vídeo unido, URL del vídeo unido y
 *      parámetros de vídeo (fps/ancho/alto) (Req 2.1, 2.2).
 *   2. Renderizar una pista horizontal proporcional a `duracion_s`, con un
 *      BLOQUE por cada tramo a borrar cuya anchura relativa es
 *      `(fin_s - inicio_s) / duracion_s` (Req 2.5).
 *   3. Permitir edición con eventos de puntero NATIVOS (sin librerías nuevas,
 *      Req 18.4): arrastrar el cuerpo del bloque = mover (conserva duración);
 *      arrastrar el borde izquierdo/derecho = cambiar inicio/fin; botones para
 *      AÑADIR y ELIMINAR tramos (Req 3.1–3.4).
 *   4. Aplicar en todo momento el clamp a `[0, duracion_s]`, descartar tramos
 *      con duración `<= 0` y fusionar los solapados/adyacentes manteniendo el
 *      orden ascendente (misma semántica que el backend; helper puro y
 *      exportable `normalizarTramos`) (Req 3.5, 3.6).
 *   5. Confirmar con `enviarSilencios(jobId, tramos)` (`POST /silencios/{id}`) y
 *      luego invocar `onEnviado?.()` para que el orquestador siga el progreso
 *      (Req 5.1).
 *
 * Previsualización en vivo (NICE-TO-HAVE, no bloqueante — Req 4.1, 4.2, 18.1):
 * si hay `video_url`, se monta `@remotion/player` con el vídeo unido como fondo
 * (reutilizando la composición `ShortVideo` sin subtítulos) y un cursor de
 * scrubbing sincronizado. Si el player no está disponible o falla la carga del
 * vídeo, se degrada con elegancia (Error Boundary) permitiendo editar/confirmar
 * los tramos SIN preview, sin bloquear el flujo de edición.
 */

import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { Player } from '@remotion/player';
import type { PlayerRef } from '@remotion/player';

import { ShortVideo } from '@/components/remotion/ShortVideo';
import type { Estilo, ShortVideoProps } from '@/components/remotion/types';
import { ApiError, enviarSilencios, obtenerSilencios } from '@/lib/api';
import { AJUSTES_POR_DEFECTO } from '@/lib/defaults';
import { estiloDesdeAjustes } from '@/lib/estilo';
import { calcularDurationInFrames } from '@/lib/remotion-map';
import type { SilenciosEdicion, TramoSilencio } from '@/lib/types';

// ---------------------------------------------------------------------------
// Helper PURO de normalización (exportable para las pruebas de la tarea 10.2)
// ---------------------------------------------------------------------------

/**
 * Normaliza una lista de tramos a BORRAR con la MISMA semántica que el backend
 * (`segmentos_conservar_desde_borrado`, design §7.1, pasos 1 y 2), pero SIN
 * calcular el complemento: devuelve los propios tramos a borrar ya saneados.
 *
 * Garantías (Req 3.5, 3.6):
 *   1. Cada tramo se recorta (clamp) a `[0, duracion]`.
 *   2. Se descartan los tramos degenerados cuya duración resultante sea `<= 0`.
 *   3. Los tramos solapados o ADYACENTES (que se tocan, `inicio <= fin_previo`)
 *      se fusionan en uno solo.
 *   4. La lista resultante queda ordenada ascendentemente por `inicio_s` y sin
 *      solapes entre tramos.
 *
 * Es una función PURA (no muta la entrada) para poder testearla de forma
 * aislada con propiedades (fast-check).
 *
 * @param tramos Lista de tramos a borrar (posiblemente desordenada/solapada).
 * @param duracion Duración total del vídeo unido, en segundos.
 * @returns Lista de tramos saneada (ordenada, sin solapes, dentro de rango).
 */
export function normalizarTramos(
  tramos: readonly TramoSilencio[],
  duracion: number,
): TramoSilencio[] {
  // Sin duración positiva no hay línea de tiempo válida: no hay tramos.
  if (!Number.isFinite(duracion) || duracion <= 0) return [];

  // (1) Clamp a [0, duracion] y descarte de tramos con duración <= 0.
  const normalizados: TramoSilencio[] = [];
  for (const t of tramos) {
    if (!Number.isFinite(t.inicio_s) || !Number.isFinite(t.fin_s)) continue;
    const inicio_s = Math.max(0, Math.min(t.inicio_s, duracion));
    const fin_s = Math.max(0, Math.min(t.fin_s, duracion));
    if (fin_s > inicio_s) normalizados.push({ inicio_s, fin_s });
  }

  // Orden ascendente por inicio (estable) antes de fusionar.
  normalizados.sort((a, b) => a.inicio_s - b.inicio_s);

  // (2) Fusión de tramos solapados o adyacentes (se tocan en el borde).
  const fusionados: TramoSilencio[] = [];
  for (const t of normalizados) {
    const ultimo = fusionados[fusionados.length - 1];
    if (ultimo && t.inicio_s <= ultimo.fin_s) {
      // Solapado o adyacente: se extiende el fin del último si procede.
      ultimo.fin_s = Math.max(ultimo.fin_s, t.fin_s);
    } else {
      fusionados.push({ inicio_s: t.inicio_s, fin_s: t.fin_s });
    }
  }

  return fusionados;
}

// ---------------------------------------------------------------------------
// Límite de error del vídeo de fondo (preview nice-to-have)
// ---------------------------------------------------------------------------

/** Props del límite de error de la preview (`LimiteErrorPreview`). */
interface LimiteErrorPreviewProps {
  /** Contenido normal a renderizar (el `<Player>`). */
  children: ReactNode;
}

/** Estado interno del límite de error de la preview. */
interface LimiteErrorPreviewState {
  /** `true` cuando el subárbol (Player/composición) ha lanzado al renderizar. */
  huboError: boolean;
}

/**
 * `LimiteErrorPreview` — React Error Boundary que AÍSLA los fallos de carga o
 * render del vídeo unido en la previsualización (nice-to-have, Req 4.2).
 *
 * Envuelve SOLO el `<Player>`. Si el Player o la composición lanzan (p. ej. el
 * navegador no puede reproducir el MP4 por códec/red, o `@remotion/player` no
 * está disponible), este boundary captura el error para que NO se propague ni
 * rompa el timeline: el resto de la UI (pista de tramos, botones de añadir/
 * eliminar y "Confirmar") permanece intacta y operativa, degradando la preview
 * con elegancia (Req 4.2, sin bloquear el flujo de edición).
 */
class LimiteErrorPreview extends Component<
  LimiteErrorPreviewProps,
  LimiteErrorPreviewState
> {
  constructor(props: LimiteErrorPreviewProps) {
    super(props);
    this.state = { huboError: false };
  }

  /** Ante un error en el subárbol, conmuta a la vista de fallback. */
  static getDerivedStateFromError(): LimiteErrorPreviewState {
    return { huboError: true };
  }

  /** Registra el error de carga/render del vídeo para diagnóstico. */
  componentDidCatch(error: unknown): void {
    // Se registra sin propagar: el fallo del vídeo queda contenido aquí.
    console.error(
      'Error al cargar/reproducir el vídeo unido en la previsualización del timeline:',
      error,
    );
  }

  render(): ReactNode {
    if (this.state.huboError) {
      // Fallback discreto: la preview no está disponible, pero editar/confirmar
      // los tramos sigue siendo posible (Req 4.2).
      return (
        <div
          data-testid="preview-error"
          role="alert"
          className="flex items-center justify-center rounded bg-black/60 p-4 text-center text-sm text-yellow-300"
        >
          No se pudo cargar la previsualización del vídeo; puedes seguir editando
          y confirmando los tramos.
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

/** Alto en píxeles del lienzo 9:16 de la previsualización (igual que el playground). */
const ALTO_PREVIEW_PX = 480;

/** Duración por defecto (segundos) de un tramo nuevo al pulsar "Añadir tramo". */
const DURACION_TRAMO_NUEVO_S = 1.0;

/**
 * Estilo por defecto para la preview. Se reutiliza la proyección centralizada
 * `estiloDesdeAjustes` (no se duplica el mapeo). En el timeline no se muestran
 * subtítulos (grupos vacíos), por lo que el estilo solo afecta a una capa que
 * no renderiza nada; se mantiene por coherencia con el contrato de la
 * composición `ShortVideo`.
 */
const ESTILO_PREVIEW: Estilo = estiloDesdeAjustes(
  AJUSTES_POR_DEFECTO.subtitulos,
);

/** Modo de arrastre de un bloque de la pista. */
type ModoArrastre = 'mover' | 'inicio' | 'fin';

/** Estado interno del arrastre en curso (fuera de React para evitar stale). */
interface EstadoArrastre {
  /** Índice del tramo que se está editando. */
  indice: number;
  /** Qué parte del bloque se arrastra. */
  modo: ModoArrastre;
  /** Coordenada X del puntero al iniciar el arrastre. */
  xInicial: number;
  /** Copia del tramo en el instante de iniciar el arrastre (referencia base). */
  tramoInicial: TramoSilencio;
}

/** Props de `TimelineSilencios` (contrato del diseño, §3.2). */
export interface TimelineSilenciosProps {
  /** Id del Job pausado en `esperando_edicion_silencios`. */
  jobId: string;
  /** URL base del backend (inyectable en tests). */
  baseUrl?: string;
  /** Se invoca cuando los tramos se envían correctamente (reanudación). */
  onEnviado?: () => void;
  // --- Inyecciones opcionales para tests ---
  /** Reemplazo de `obtenerSilencios` (carga inicial). */
  obtenerFn?: typeof obtenerSilencios;
  /** Reemplazo de `enviarSilencios` (confirmación). */
  enviarFn?: typeof enviarSilencios;
}

/**
 * Timeline de edición de silencios. Ver la documentación de módulo (arriba) para
 * el flujo completo. La preview con `@remotion/player` es opcional y degrada con
 * elegancia si no está disponible.
 */
export default function TimelineSilencios({
  jobId,
  baseUrl,
  onEnviado,
  obtenerFn = obtenerSilencios,
  enviarFn = enviarSilencios,
}: TimelineSilenciosProps) {
  // Datos cargados del backend (solo lectura tras la carga inicial).
  const [datos, setDatos] = useState<SilenciosEdicion | null>(null);
  // Lista de tramos EDITABLE (copia de trabajo saneada).
  const [tramos, setTramos] = useState<TramoSilencio[]>([]);
  // Posición del cursor de scrubbing, en segundos (preview nice-to-have).
  const [cursorS, setCursorS] = useState(0);

  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Referencia a la pista para convertir píxeles ⇄ segundos con su ancho real.
  const pistaRef = useRef<HTMLDivElement | null>(null);
  // Estado del arrastre en curso; en ref para no depender de re-renders.
  const arrastreRef = useRef<EstadoArrastre | null>(null);
  // Referencia al Player para el scrubbing (seek).
  const playerRef = useRef<PlayerRef | null>(null);

  const duracion = datos?.duracion_s ?? 0;
  const editable = datos?.editable ?? false;

  // --- Carga inicial (GET /silencios/{id}) ---
  useEffect(() => {
    let cancelado = false;
    setCargando(true);
    setError(null);
    obtenerFn(jobId, { baseUrl })
      .then((res) => {
        if (cancelado) return;
        setDatos(res);
        // Se sanea de entrada por robustez, aunque el backend ya los entrega
        // ordenados y sin solapes (Req 2.1).
        setTramos(normalizarTramos(res.tramos, res.duracion_s));
      })
      .catch((err) => {
        if (cancelado) return;
        setError(
          err instanceof ApiError
            ? err.message
            : 'No se pudieron cargar los tramos de silencio.',
        );
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [jobId, baseUrl, obtenerFn]);

  // --- Conversión de píxeles a segundos según el ancho real de la pista ---
  const pxASegundos = useCallback(
    (px: number): number => {
      const cont = pistaRef.current;
      if (!cont || duracion <= 0) return 0;
      const ancho = cont.getBoundingClientRect().width;
      if (ancho <= 0) return 0;
      return (px / ancho) * duracion;
    },
    [duracion],
  );

  // --- Manejadores de arrastre (eventos de puntero nativos) ---

  /**
   * Actualiza el tramo en edición mientras el puntero se mueve. Aplica el clamp
   * a `[0, duracion]` y mantiene `inicio < fin` según el modo (Req 3.1, 3.2,
   * 3.5). La fusión de solapados se difiere a `alSoltar` para no alterar el
   * bloque que el usuario está manipulando en pleno arrastre (Req 3.6).
   */
  const alMover = useCallback(
    (e: PointerEvent) => {
      const arr = arrastreRef.current;
      if (!arr) return;
      const deltaS = pxASegundos(e.clientX - arr.xInicial);
      const base = arr.tramoInicial;
      setTramos((prev) => {
        if (arr.indice < 0 || arr.indice >= prev.length) return prev;
        const copia = prev.map((t) => ({ ...t }));
        if (arr.modo === 'mover') {
          // Mover conserva la duración; se recorta a [0, duracion].
          const dur = base.fin_s - base.inicio_s;
          let inicio = base.inicio_s + deltaS;
          inicio = Math.max(0, Math.min(inicio, duracion - dur));
          copia[arr.indice] = { inicio_s: inicio, fin_s: inicio + dur };
        } else if (arr.modo === 'inicio') {
          // Estirar/achicar por el borde izquierdo, manteniendo inicio < fin.
          let inicio = base.inicio_s + deltaS;
          inicio = Math.max(0, Math.min(inicio, base.fin_s));
          copia[arr.indice] = { inicio_s: inicio, fin_s: base.fin_s };
        } else {
          // Estirar/achicar por el borde derecho, manteniendo fin > inicio.
          let fin = base.fin_s + deltaS;
          fin = Math.max(base.inicio_s, Math.min(fin, duracion));
          copia[arr.indice] = { inicio_s: base.inicio_s, fin_s: fin };
        }
        return copia;
      });
    },
    [pxASegundos, duracion],
  );

  /**
   * Finaliza el arrastre: elimina los listeners globales y sanea la lista
   * (descarta degenerados y fusiona solapados/adyacentes, Req 3.5, 3.6).
   */
  const alSoltar = useCallback(() => {
    arrastreRef.current = null;
    window.removeEventListener('pointermove', alMover);
    window.removeEventListener('pointerup', alSoltar);
    setTramos((prev) => normalizarTramos(prev, duracion));
  }, [alMover, duracion]);

  /**
   * Inicia el arrastre de un bloque (o de uno de sus bordes). Registra los
   * listeners globales para seguir el puntero aunque salga del bloque.
   */
  const alPresionar = useCallback(
    (e: React.PointerEvent, indice: number, modo: ModoArrastre) => {
      if (!editable) return;
      // Evita selección de texto y que el arrastre del borde active el del cuerpo.
      e.preventDefault();
      e.stopPropagation();
      setTramos((prev) => {
        const actual = prev[indice];
        if (!actual) return prev;
        arrastreRef.current = {
          indice,
          modo,
          xInicial: e.clientX,
          tramoInicial: { ...actual },
        };
        return prev;
      });
      window.addEventListener('pointermove', alMover);
      window.addEventListener('pointerup', alSoltar);
    },
    [editable, alMover, alSoltar],
  );

  // Limpieza defensiva: si el componente se desmonta a mitad de un arrastre,
  // se retiran los listeners globales para no dejar fugas.
  useEffect(() => {
    return () => {
      window.removeEventListener('pointermove', alMover);
      window.removeEventListener('pointerup', alSoltar);
    };
  }, [alMover, alSoltar]);

  // --- Añadir / eliminar tramos ---

  /**
   * Añade un tramo NUEVO en la posición del cursor (`cursorS`), con
   * `0 <= inicio < fin <= duracion` (Req 2.1, 2.2, 2.3).
   *
   * A diferencia de la versión anterior (que colocaba el inicio en el fin del
   * último tramo y por eso `normalizarTramos` lo fusionaba, agrandándolo e
   * ignorando el cursor), este manejador:
   *
   *   1. Toma la posición del cursor recortada a `[0, duracion]`
   *      (`inicioDeseado`).
   *   2. Calcula los HUECOS LIBRES (complemento de los tramos ya saneados en
   *      `[0, duracion]`, misma idea que {@link segmentosConservar}). Cada hueco
   *      `[g0, g1]` tiene anchura estrictamente positiva.
   *   3. Elige el hueco objetivo: el que CONTIENE al cursor; si el cursor cae
   *      dentro de un tramo, el primer hueco que empiece en/después del cursor
   *      (o el último si no hay ninguno). Si NO hay huecos, devuelve `prev` sin
   *      cambios (el timeline está lleno).
   *   4. Coloca el tramo nuevo en el INTERIOR del hueco, sin compartir borde con
   *      los tramos vecinos reales: si el borde del hueco corresponde a un tramo
   *      (no al principio/fin del vídeo) se deja un margen estricto para que
   *      `normalizarTramos` NO lo fusione (regla de adyacencia `<=`).
   *
   * Así el número de tramos aumenta exactamente en 1 y el nuevo bloque aparece
   * donde está el usuario. `normalizarTramos` y `segmentosConservar` no se tocan.
   */
  const anadirTramo = useCallback(() => {
    if (!editable) return;
    setTramos((prev) => {
      if (duracion <= 0) return prev;

      // (1) Posición deseada = cursor recortado a [0, duracion].
      const inicioDeseado = Math.max(0, Math.min(cursorS, duracion));

      // (2) Huecos libres = complemento de los tramos saneados en [0, duracion].
      const huecos = segmentosConservar(prev, duracion);
      if (huecos.length === 0) return prev; // Timeline lleno: nada que añadir.

      // (3) Hueco objetivo: el que contiene el cursor; si no (cursor dentro de
      // un tramo), el primer hueco que empiece en/después del cursor, o el último.
      const objetivo =
        huecos.find(
          (h) => inicioDeseado >= h.inicioS && inicioDeseado <= h.finS,
        ) ??
        huecos.find((h) => h.inicioS >= inicioDeseado) ??
        huecos[huecos.length - 1];

      const g0 = objetivo.inicioS;
      const g1 = objetivo.finS;
      // Un borde es "real" (hay un tramo vecino) si no coincide con el
      // principio (0) ni el fin (duracion) del vídeo.
      const izquierdaReal = g0 > 0;
      const derechaReal = g1 < duracion;

      // (4) Colocar en el interior del hueco, con margen estricto en los bordes
      // que tocan tramos reales para evitar la fusión por adyacencia.
      const margen = Math.min(1e-3, (g1 - g0) / 4);
      const lo = izquierdaReal ? g0 + margen : g0;
      const hi = derechaReal ? g1 - margen : g1;
      if (hi <= lo) return prev; // Hueco demasiado pequeño para un tramo nuevo.

      let inicio = Math.max(lo, Math.min(inicioDeseado, hi));
      let fin = Math.min(inicio + DURACION_TRAMO_NUEVO_S, hi);
      // Si el cursor queda pegado al borde derecho y no cabe la duración,
      // retroceder el inicio para garantizar duración positiva dentro del hueco.
      if (fin - inicio <= 0) {
        inicio = Math.max(lo, hi - DURACION_TRAMO_NUEVO_S);
        fin = hi;
      }
      if (fin - inicio <= 0) return prev; // No hay espacio útil.

      const nuevo: TramoSilencio = { inicio_s: inicio, fin_s: fin };
      return normalizarTramos([...prev, nuevo], duracion);
    });
  }, [editable, duracion, cursorS]);

  /**
   * Elimina el tramo indicado sin alterar los demás (Req 3.4).
   */
  const eliminarTramo = useCallback(
    (indice: number) => {
      if (!editable) return;
      setTramos((prev) => prev.filter((_, i) => i !== indice));
    },
    [editable],
  );

  // --- Confirmación (POST /silencios/{id}) ---

  /**
   * Envía los tramos saneados y, en éxito (202), invoca `onEnviado` para que el
   * orquestador siga el progreso del Job (Req 5.1). Ante error (p. ej. 409/400)
   * muestra el mensaje sin romper la UI.
   */
  const confirmar = useCallback(async () => {
    if (enviando || !editable) return;
    setEnviando(true);
    setError(null);
    try {
      const saneados = normalizarTramos(tramos, duracion);
      await enviarFn(jobId, saneados, { baseUrl });
      onEnviado?.();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'No se pudieron enviar los tramos de silencio.',
      );
      setEnviando(false);
    }
  }, [enviando, editable, tramos, duracion, jobId, baseUrl, enviarFn, onEnviado]);

  // --- Scrubbing en la pista (mueve el cursor y hace seek en el Player) ---

  /**
   * Al hacer clic en la zona vacía de la pista, mueve el cursor a esa posición
   * temporal (dentro de `[0, duracion]`) y sincroniza el Player si está montado
   * (Req 4.1). Es nice-to-have: si no hay Player, solo actualiza el cursor.
   */
  const alClicPista = useCallback(
    (e: React.PointerEvent) => {
      const cont = pistaRef.current;
      if (!cont || duracion <= 0) return;
      const rect = cont.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const seg = Math.max(0, Math.min(pxASegundos(px), duracion));
      setCursorS(seg);
      // Seek best-effort del Player (si está montado y disponible).
      try {
        const fps = datos?.fps ?? 30;
        playerRef.current?.seekTo(Math.round(seg * fps));
      } catch {
        // La preview es opcional: un fallo de seek no afecta a la edición.
      }
    },
    [duracion, pxASegundos, datos],
  );

  // --- Props de la composición para la preview (fondo = vídeo unido) ---
  const videoUrl = datos?.video_url ?? null;
  const fps = datos?.fps ?? 30;
  const ancho = datos?.ancho ?? 1080;
  const alto = datos?.alto ?? 1920;

  const durationInFrames = useMemo(
    () => calcularDurationInFrames(duracion, fps, []),
    [duracion, fps],
  );

  const inputPreview: ShortVideoProps = useMemo(
    () => ({
      videoSrc: videoUrl ?? '',
      fps,
      width: ancho,
      height: alto,
      durationInFrames,
      estilo: ESTILO_PREVIEW,
      combineTokensWithinMs: AJUSTES_POR_DEFECTO.render.combine_tokens_ms,
      // Sin subtítulos ni textos extra: el timeline solo muestra el vídeo unido.
      grupos: [],
      textosExtra: [],
    }),
    [videoUrl, fps, ancho, alto, durationInFrames],
  );

  // Ancho del lienzo manteniendo la proporción real del vídeo.
  const anchoPreviewPx = useMemo(() => {
    if (!Number.isFinite(ancho) || !Number.isFinite(alto) || alto <= 0) {
      return Math.round((ALTO_PREVIEW_PX * 9) / 16);
    }
    return Math.round((ALTO_PREVIEW_PX * ancho) / alto);
  }, [ancho, alto]);

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-editor-border bg-editor-panel p-4"
      data-testid="timeline-silencios"
    >
      <div>
        <h3 className="text-lg font-medium text-white">
          Editar silencios (timeline)
        </h3>
        <p className="mt-1 text-sm text-gray-400">
          Ajusta los tramos que se van a BORRAR del vídeo. Arrastra el bloque
          para moverlo, los bordes para cambiar su inicio o fin, y usa los
          botones para añadir o eliminar tramos. Al confirmar se reconstruye el
          vídeo recortado y continúa la transcripción.
        </p>
      </div>

      {cargando && (
        <p data-testid="timeline-cargando" className="text-sm text-gray-300">
          Cargando tramos de silencio…
        </p>
      )}

      {error && (
        <p
          role="alert"
          data-testid="timeline-error"
          className="text-sm text-red-400"
        >
          {error}
        </p>
      )}

      {datos && !cargando && (
        <>
          {/*
            Previsualización en vivo (nice-to-have, Req 4.1/4.2): se monta el
            Player solo si hay `video_url`. Se envuelve en `LimiteErrorPreview`
            para AÍSLAR cualquier fallo de carga/reproducción del vídeo y
            degradar con elegancia sin bloquear la edición.
          */}
          {videoUrl && (
            <div data-testid="timeline-preview" className="self-center">
              <LimiteErrorPreview>
                <Player
                  ref={playerRef}
                  component={ShortVideo}
                  inputProps={inputPreview}
                  durationInFrames={durationInFrames}
                  compositionWidth={ancho}
                  compositionHeight={alto}
                  fps={fps}
                  controls
                  style={{ width: anchoPreviewPx, height: ALTO_PREVIEW_PX }}
                />
              </LimiteErrorPreview>
            </div>
          )}

          {/*
            Pista horizontal proporcional a `duracion_s`. Cada bloque representa
            un tramo a borrar con anchura relativa (fin-inicio)/duracion y
            posición izquierda inicio/duracion (Req 2.5). El clic en la zona
            vacía mueve el cursor de scrubbing (Req 4.1).
          */}
          <div
            ref={pistaRef}
            data-testid="timeline-pista"
            onPointerDown={alClicPista}
            className="relative h-16 w-full select-none overflow-hidden rounded border border-editor-border bg-gray-900"
          >
            {tramos.map((t, i) => {
              const izquierdaPct =
                duracion > 0 ? (t.inicio_s / duracion) * 100 : 0;
              const anchoPct =
                duracion > 0
                  ? ((t.fin_s - t.inicio_s) / duracion) * 100
                  : 0;
              return (
                <div
                  key={i}
                  data-testid={`timeline-bloque-${i}`}
                  onPointerDown={(e) => alPresionar(e, i, 'mover')}
                  style={{
                    left: `${izquierdaPct}%`,
                    width: `${anchoPct}%`,
                  }}
                  className={`absolute top-0 flex h-full items-center justify-between rounded bg-red-500/70 ${
                    editable ? 'cursor-grab' : 'cursor-default'
                  }`}
                >
                  {/* Borde izquierdo: cambia el inicio. */}
                  <div
                    data-testid={`timeline-borde-inicio-${i}`}
                    onPointerDown={(e) => alPresionar(e, i, 'inicio')}
                    className={`h-full w-2 rounded-l bg-red-300 ${
                      editable ? 'cursor-ew-resize' : 'cursor-default'
                    }`}
                  />
                  {/* Botón eliminar (centro superior del bloque). */}
                  {editable && (
                    <button
                      type="button"
                      data-testid={`timeline-eliminar-${i}`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        eliminarTramo(i);
                      }}
                      aria-label={`Eliminar tramo ${i + 1}`}
                      className="rounded bg-black/40 px-1 text-xs text-white hover:bg-black/70"
                    >
                      ×
                    </button>
                  )}
                  {/* Borde derecho: cambia el fin. */}
                  <div
                    data-testid={`timeline-borde-fin-${i}`}
                    onPointerDown={(e) => alPresionar(e, i, 'fin')}
                    className={`h-full w-2 rounded-r bg-red-300 ${
                      editable ? 'cursor-ew-resize' : 'cursor-default'
                    }`}
                  />
                </div>
              );
            })}

            {/* Cursor de scrubbing (posición temporal seleccionada). */}
            {duracion > 0 && (
              <div
                data-testid="timeline-cursor"
                style={{ left: `${(cursorS / duracion) * 100}%` }}
                className="pointer-events-none absolute top-0 h-full w-0.5 bg-yellow-300"
              />
            )}
          </div>

          {/* Información y controles. */}
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span data-testid="timeline-duracion">
              Duración: {duracion.toFixed(1)} s
            </span>
            <span data-testid="timeline-num-tramos">
              Tramos: {tramos.length}
            </span>
            <span data-testid="timeline-cursor-pos">
              Cursor: {cursorS.toFixed(1)} s
            </span>
          </div>

          <div
            className="mt-1 flex items-center gap-3 border-t border-editor-border pt-3"
            data-testid="timeline-acciones"
          >
            <button
              type="button"
              data-testid="timeline-anadir"
              onClick={anadirTramo}
              disabled={!editable || duracion <= 0}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              Añadir tramo
            </button>
            <button
              type="button"
              data-testid="timeline-confirmar"
              onClick={confirmar}
              disabled={enviando || !editable}
              className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
            >
              {enviando ? 'Confirmando…' : 'Confirmar'}
            </button>
            {!editable && (
              <span className="text-sm text-gray-400">
                Este Job no está en edición de silencios; los tramos son de solo
                lectura.
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
