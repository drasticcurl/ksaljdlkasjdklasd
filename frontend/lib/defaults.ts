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
    umbral_db: -30,
    margen_ms: 200,
    min_silencio_ms: 300,
  },
  transcripcion: {
    idioma: 'es',
    modelo: 'small',
  },
  subtitulos: {
    max_palabras: 4,
    posicion_vertical: 'inferior',
    posicion_horizontal: 'centro',
    pos_vertical_pct: 85,
    pos_horizontal_pct: 50,
    margen_px: 60,
    fuente: 'Arial',
    tamano: 72,
    color: '#FFFFFF',
    color_borde: '#000000',
    grosor_borde: 5,
    negrita: true,
    anim_entrada_ms: 300,
    anim_salida_ms: 300,
    slide_px: 50,
    revisar_antes_de_renderizar: true,
  },
  // La música es opcional: null hasta que se sube un WAV válido (Req 8.1).
  musica: null,
};
