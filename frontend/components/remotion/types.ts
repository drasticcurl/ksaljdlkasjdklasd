// COPIA para el navegador de remotion/src/types.ts.
//
// IMPORTANTE: mantener EN SINCRONÍA con `remotion/src/types.ts` del subproyecto
// Node. Este archivo existe porque @remotion/player renderiza la composición en
// el navegador (React + hooks de `remotion`) y necesita el mismo contrato de
// props. Cualquier cambio en el contrato debe reflejarse en ambos lugares y en
// `backend/app/engine/remotion.py` (construir_props).

/** Una palabra con su timing en milisegundos (para el resaltado karaoke). */
export type Palabra = {
  /** Texto de la palabra (sin espacios). */
  text: string;
  /** Milisegundo de inicio de la palabra. */
  startMs: number;
  /** Milisegundo de fin de la palabra. */
  endMs: number;
};

/**
 * Un grupo es una frase/subtitulo que se muestra completo a la vez.
 * `words` puede venir vacio: en ese caso se divide `text` por espacios y se
 * muestra sin resaltado palabra-por-palabra.
 */
export type Grupo = {
  /** Texto completo del grupo (frase). */
  text: string;
  /** Milisegundo de inicio del grupo (cuando aparece). */
  startMs: number;
  /** Milisegundo de fin del grupo (cuando desaparece). */
  endMs: number;
  /** Palabras con timing; puede estar vacio. */
  words: Palabra[];
};

/** Estilo visual de los subtitulos (mapeado desde AjustesSubtitulos en Python). */
export type Estilo = {
  /** Familia tipografica (p. ej. "Inter", "Arial"). */
  fuente: string;
  /** Tamano de fuente en pixeles. */
  tamano: number;
  /** Color base del texto en formato #RRGGBB. */
  color: string;
  /** Color de la palabra actualmente resaltada, en formato #RRGGBB. */
  colorResaltado: string;
  /** Posicion vertical del bloque de subtitulos, en porcentaje 0..100 (0 arriba, 100 abajo). */
  posVerticalPct: number;
  /** Duracion de la animacion de entrada de cada grupo, en milisegundos. */
  animEntradaMs: number;
};

/** Propiedades de entrada de la composicion `ShortVideo`. */
export type ShortVideoProps = {
  /**
   * URL http del video de fondo ya cortado. Si es "" o null => fondo blanco
   * (modo playground).
   */
  videoSrc: string;
  /** Cuadros por segundo del render. */
  fps: number;
  /** Ancho del video en pixeles. */
  width: number;
  /** Alto del video en pixeles. */
  height: number;
  /** Duracion total en frames (derivada de la duracion del video * fps). */
  durationInFrames: number;
  /** Estilo visual de los subtitulos. */
  estilo: Estilo;
  /**
   * Ventana de agrupacion estilo TikTok, en milisegundos. Ya no es
   * imprescindible (los grupos vienen pre-agrupados desde el backend); se
   * mantiene por compatibilidad y puede ignorarse.
   */
  combineTokensWithinMs: number;
  /** Subtitulos agrupados en frases (con palabras opcionales con timing). */
  grupos: Grupo[];
};
