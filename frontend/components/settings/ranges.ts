/**
 * Helper compartido de rangos y validación de la UI para los paneles de ajustes
 * (`components/settings/*`) y el `MusicUploader`.
 *
 * La Interfaz valida cada campo contra el **rango de la UI** del Requisito 9
 * (más amplio que el rango del motor en varios campos). El backend revalida con
 * el rango del motor (ver `backend/app/models/settings.py`).
 *
 * Estas utilidades son puras (sin JSX ni efectos) para poder reutilizarlas en
 * los componentes y testearlas directamente.
 *
 * Requisitos: 9.1, 9.2, 9.3, 9.4, 9.7, 8.1.
 */

// ---------------------------------------------------------------------------
// Rangos de la UI por campo (mínimo y máximo, ambos inclusivos) — Req 9.1-9.4
// ---------------------------------------------------------------------------

/** Un rango numérico inclusivo `[min, max]`. */
export interface RangoUI {
  min: number;
  max: number;
}

/**
 * Rangos de la UI indexados por la ruta con puntos del campo. Fuente única de
 * verdad usada por los paneles de ajustes y sus tests.
 */
export const RANGOS_UI = {
  // Generales — Resolución objetivo y fps (Req 9.3, 3.2, 3.5).
  'generales.resolucion.ancho': { min: 2, max: 7680 },
  'generales.resolucion.alto': { min: 2, max: 7680 },
  'generales.fps': { min: 1, max: 120 },
  // Silencios (Req 9.2).
  'silencios.umbral_db': { min: -60, max: 0 },
  'silencios.margen_ms': { min: 0, max: 5000 },
  // Transiciones — duración del efecto entre clips (ms).
  'transiciones.duracion_ms': { min: 100, max: 2000 },
  // Subtítulos (Req 9.1).
  'subtitulos.pos_vertical_pct': { min: 0, max: 100 },
  'subtitulos.pos_horizontal_pct': { min: 0, max: 100 },
  'subtitulos.margen_px': { min: 0, max: 500 },
  'subtitulos.tamano': { min: 8, max: 200 },
  'subtitulos.grosor_borde': { min: 0, max: 50 },
  'subtitulos.max_palabras': { min: 1, max: 20 },
  'subtitulos.anim_entrada_ms': { min: 0, max: 5000 },
  'subtitulos.anim_salida_ms': { min: 0, max: 5000 },
  'subtitulos.slide_px': { min: 0, max: 500 },
  // Música (Req 9.4, 8.4).
  'musica.volumen_base_pct': { min: 0, max: 100 },
} as const satisfies Record<string, RangoUI>;

/** Ruta con puntos de un campo con rango numérico de la UI. */
export type CampoRango = keyof typeof RANGOS_UI;

// ---------------------------------------------------------------------------
// Conjuntos admitidos (Req 9.3) — alineados con backend/app/models/settings.py
// ---------------------------------------------------------------------------

/** Valor especial de idioma que activa la detección automática (Req 5.2, 5.4). */
export const IDIOMA_AUTO = 'auto';

/**
 * Idiomas admitidos por faster-whisper (códigos ISO 639-1/2). El valor especial
 * "auto" se añade aparte en {@link idiomasSeleccionables}.
 */
export const SUPPORTED_WHISPER_LANGUAGES: readonly string[] = [
  'en', 'zh', 'de', 'es', 'ru', 'ko', 'fr', 'ja', 'pt', 'tr', 'pl', 'ca',
  'nl', 'ar', 'sv', 'it', 'id', 'hi', 'fi', 'vi', 'he', 'uk', 'el', 'ms',
  'cs', 'ro', 'da', 'hu', 'ta', 'no', 'th', 'ur', 'hr', 'bg', 'lt', 'la',
  'mi', 'ml', 'cy', 'sk', 'te', 'fa', 'lv', 'bn', 'sr', 'az', 'sl', 'kn',
  'et', 'mk', 'br', 'eu', 'is', 'hy', 'ne', 'mn', 'bs', 'kk', 'sq', 'sw',
  'gl', 'mr', 'pa', 'si', 'km', 'sn', 'yo', 'so', 'af', 'oc', 'ka', 'be',
  'tg', 'sd', 'gu', 'am', 'yi', 'lo', 'uz', 'fo', 'ht', 'ps', 'tk', 'nn',
  'mt', 'sa', 'lb', 'my', 'bo', 'tl', 'mg', 'as', 'tt', 'haw', 'ln', 'ha',
  'ba', 'jw', 'su', 'yue',
];

/** Modelos admitidos por faster-whisper (incluye variantes .en y destiladas). */
export const SUPPORTED_WHISPER_MODELS: readonly string[] = [
  'tiny', 'tiny.en', 'base', 'base.en', 'small', 'small.en', 'medium',
  'medium.en', 'large-v1', 'large-v2', 'large-v3', 'large', 'large-v3-turbo',
  'turbo', 'distil-small.en', 'distil-medium.en', 'distil-large-v2',
  'distil-large-v3',
];

/** Lista de idiomas seleccionables en la UI: "auto" seguido de los admitidos. */
export function idiomasSeleccionables(): string[] {
  return [IDIOMA_AUTO, ...SUPPORTED_WHISPER_LANGUAGES];
}

/**
 * Tipos de transición seleccionables en la UI, con su etiqueta legible. El
 * valor debe coincidir con `TipoTransicion` del backend/tipos del frontend.
 */
export const TIPOS_TRANSICION: ReadonlyArray<{ valor: string; etiqueta: string }> = [
  { valor: 'ninguna', etiqueta: 'Sin transición (corte)' },
  { valor: 'disolucion', etiqueta: 'Disolución' },
  { valor: 'fundido_negro', etiqueta: 'Fundido a negro' },
  { valor: 'deslizar_izq', etiqueta: 'Deslizar (izquierda)' },
  { valor: 'deslizar_arriba', etiqueta: 'Deslizar (arriba)' },
];

/** Fuentes disponibles para los subtítulos (Req 9.1). */
export const FUENTES_DISPONIBLES: readonly string[] = [
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Courier New',
  'Verdana',
  'Georgia',
  'Impact',
  'Roboto',
  'Montserrat',
  'Open Sans',
];

/** Formato de color hexadecimal `#RRGGBB` (Req 7.8, 9.1). */
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

// ---------------------------------------------------------------------------
// Predicados de validación (Req 9.1-9.4, 9.6)
// ---------------------------------------------------------------------------

/** Indica si `valor` es un número finito dentro del rango inclusivo dado. */
export function numeroEnRango(valor: number, rango: RangoUI): boolean {
  return Number.isFinite(valor) && valor >= rango.min && valor <= rango.max;
}

/** Valida un campo por su ruta contra su rango de la UI. */
export function campoEnRango(campo: CampoRango, valor: number): boolean {
  return numeroEnRango(valor, RANGOS_UI[campo]);
}

/** Indica si `idioma` es "auto" o pertenece al conjunto admitido (Req 9.3). */
export function idiomaValido(idioma: string): boolean {
  return idioma === IDIOMA_AUTO || SUPPORTED_WHISPER_LANGUAGES.includes(idioma);
}

/** Indica si `modelo` pertenece a los modelos admitidos (Req 9.3). */
export function modeloValido(modelo: string): boolean {
  return SUPPORTED_WHISPER_MODELS.includes(modelo);
}

/** Indica si `color` tiene la forma hexadecimal `#RRGGBB` (Req 9.1). */
export function colorValido(color: string): boolean {
  return HEX_COLOR_RE.test(color);
}

/**
 * Extensiones de audio aceptadas por el backend (`POST /musica`). Deben
 * mantenerse alineadas con `SUPPORTED_MUSIC_EXTENSIONS` de
 * `backend/app/config.py`. La mezcla la realiza ffmpeg, que decodifica todos
 * estos formatos; por eso se aceptan por extensión.
 */
export const EXTENSIONES_AUDIO: readonly string[] = [
  '.wav',
  '.mp3',
  '.m4a',
  '.aac',
  '.ogg',
  '.oga',
  '.opus',
  '.flac',
  '.wma',
  '.aiff',
  '.aif',
];

/** Regex derivada de {@link EXTENSIONES_AUDIO} para validar por extensión. */
const AUDIO_EXT_RE = new RegExp(
  `(${EXTENSIONES_AUDIO.map((e) => e.replace('.', '\\.')).join('|')})$`,
  'i',
);

/**
 * Verifica si un nombre de archivo corresponde a un formato de audio soportado
 * por su extensión (Req 9.7). Antes solo se aceptaba `.wav`, lo que rechazaba
 * archivos de audio perfectamente válidos (MP3, AAC, OGG, FLAC, ...).
 */
export function esArchivoAudio(nombre: string): boolean {
  return AUDIO_EXT_RE.test(nombre.trim());
}

/**
 * Alias retrocompatible de {@link esArchivoAudio}. La política pasó de "solo
 * WAV" a "formatos de audio comunes"; se conserva el nombre previo para no
 * romper importaciones existentes.
 */
export const esArchivoWav = esArchivoAudio;
