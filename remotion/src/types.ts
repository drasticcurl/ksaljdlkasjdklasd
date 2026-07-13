// Contrato de `inputProps` compartido entre el backend Python
// (backend/app/engine/remotion.py -> construir_props) y la composicion Remotion.
//
// IMPORTANTE: la forma de estos tipos debe coincidir EXACTAMENTE con el
// `props.json` que serializa Python. Cualquier cambio aqui debe reflejarse alla.
import type {Caption} from '@remotion/captions';

/** Estilo visual de los subtitulos (mapeado desde AjustesSubtitulos en Python). */
export type Estilo = {
  /** Familia tipografica (p. ej. "Inter", "Arial"). */
  fuente: string;
  /** Tamano de fuente en pixeles. */
  tamano: number;
  /** Color base del texto en formato #RRGGBB. */
  color: string;
  /** Color del token (palabra) actualmente resaltado, en formato #RRGGBB. */
  colorResaltado: string;
  /** Posicion vertical del bloque de subtitulos, en porcentaje 0..100 (0 arriba, 100 abajo). */
  posVerticalPct: number;
  /** Duracion de la animacion de entrada de cada pagina, en milisegundos. */
  animEntradaMs: number;
};

/** Propiedades de entrada de la composicion `ShortVideo`. */
export type ShortVideoProps = {
  /** Ruta absoluta (o URL/file://) del video de fondo ya cortado. */
  videoSrc: string;
  /** Cuadros por segundo del render. */
  fps: number;
  /** Ancho del video en pixeles. */
  width: number;
  /** Alto del video en pixeles. */
  height: number;
  /** Duracion total en frames (derivada de la duracion del video * fps). */
  durationInFrames: number;
  /** Subtitulos en formato @remotion/captions (tiempos en milisegundos). */
  captions: Caption[];
  /** Estilo visual de los subtitulos. */
  estilo: Estilo;
  /** Ventana de agrupacion estilo TikTok, en milisegundos (createTikTokStyleCaptions). */
  combineTokensWithinMs: number;
};
