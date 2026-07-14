/**
 * Valores por defecto de los ajustes de la Interfaz, coherentes con el backend
 * (ver `.kiro/specs/vertical-shorts-editor/design.md`, "Modelo completo de
 * ajustes de configuración" y `backend/app/config.py`).
 *
 * Se usan como estado inicial del editor en `app/page.tsx` (Tarea 20.4). La
 * música arranca en `null` (paso 5 omitido) hasta que el usuario sube un WAV.
 *
 * Requisitos: 3.2, 3.5, 4.3, 5.2, 5.3, 6.1, 7.x, 8.4, 9.x.
 */

import type { Ajustes, AjustesMusica } from './types';

/** Ajustes de música por defecto (se activan al subir un WAV válido). */
export const MUSICA_POR_DEFECTO: AjustesMusica = {
  volumen_base_pct: 30,
  reduccion_db: 12,
  umbral_voz_dbfs: -30,
  ataque_ms: 250,
  liberacion_ms: 500,
};

/** Conjunto completo de ajustes por defecto del editor. */
export const AJUSTES_POR_DEFECTO: Ajustes = {
  generales: {
    resolucion: { ancho: 1080, alto: 1920 },
    fps: 30,
  },
  silencios: {
    activado: true,
    // Método por defecto: "voz" (IA/VAD), más robusto que el umbral de dB.
    modo: 'voz',
    umbral_db: -30,
    margen_ms: 200,
  },
  // Transiciones: por defecto SIN transición (corte duro), como hasta ahora.
  transiciones: {
    tipo: 'ninguna',
    duracion_ms: 400,
  },
  // Risas: por defecto activadas (se recortan los "jaja/jeje/...").
  risas: {
    activado: true,
    margen_ms: 100,
  },
  transcripcion: {
    idioma: 'es',
    modelo: 'small',
  },
  subtitulos: {
    max_palabras: 4,
    // Revisión manual desactivada por defecto (el pipeline corre completo).
    revisar: false,
    // "Aprobar subtítulos a mano" desactivado por defecto. Si se activa, el
    // pipeline pausa para revisar/corregir a mano (incluida la salida de la IA).
    aprobar_a_mano: false,
    // Texto en minúscula desactivado por defecto (se conserva la transcripción).
    minusculas: false,
    // Estilo por defecto: karaoke bold (resalta la palabra activa).
    preset: 'bold_pop',
    color_resaltado: '#FFE500',
    posicion_vertical: 'inferior',
    posicion_horizontal: 'centro',
    pos_vertical_pct: 85,
    pos_horizontal_pct: 50,
    margen_px: 60,
    // Fuente por defecto: Poppins (bold). Requiere tenerla instalada en el
    // sistema; si no está, libass usa una alternativa.
    fuente: 'Poppins',
    tamano: 72,
    color: '#FFFFFF',
    color_borde: '#000000',
    grosor_borde: 5,
    negrita: true,
    anim_entrada_ms: 300,
    anim_salida_ms: 300,
    slide_px: 50,
  },
  // La música es opcional: null hasta que se sube un WAV válido (Req 8.1).
  musica: null,
  // Corrección de subtítulos con IA (OpenAI): OPT-IN, desactivada por defecto
  // (primera dependencia de red externa). La clave de API NO se guarda aquí:
  // es transitoria y viaja aparte en POST /procesar (spec subtitulos-ia-remotion).
  revision_ia: {
    activado: false,
    modelo: 'gpt-5.4-nano',
    timeout_s: 20,
    max_reintentos: 1,
  },
  // Render de subtítulos: el motor lo elige el usuario en tiempo de ejecución;
  // `motor_preferido` solo resalta un botón en la UI (no fuerza la ejecución).
  render: {
    motor_preferido: 'ass',
    combine_tokens_ms: 1200,
  },
};
