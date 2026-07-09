/**
 * Validación global de los ajustes y del orden de clips previa al envío de
 * `POST /procesar` (Tarea 20.1).
 *
 * La Interfaz debe aceptar el envío si y solo si:
 *   - Existe al menos 1 clip en el `Orden_de_Clips` vigente (Req 2.3, 9.5) y no
 *     se superan los 500 clips (límite del backend, Req 10.2).
 *   - TODOS los campos de ajustes están dentro de su rango de la UI y de sus
 *     conjuntos admitidos (Req 9.1-9.4, 9.6).
 *
 * Cuando algo es inválido, se identifica el PRIMER campo inválido (ruta con
 * puntos, estable para `data-testid`) junto con un mensaje legible, para que la
 * UI pueda bloquear el envío y señalarlo conservando los ajustes (Req 9.6).
 *
 * Estas funciones son puras (sin JSX ni efectos) para poder reutilizarlas en
 * `components/ProcessButton.tsx` y testearlas directamente.
 *
 * Requisitos: 2.3, 9.5, 9.6, 10.2.
 */

import type { Ajustes } from './types';
import {
  RANGOS_UI,
  colorValido,
  idiomaValido,
  modeloValido,
  numeroEnRango,
  type CampoRango,
} from '@/components/settings/ranges';

/** Límite superior de clips por Job impuesto por el backend (Req 10.2). */
export const MAX_CLIPS_POR_JOB = 500;

/** Resultado de la validación global previa al procesamiento. */
export interface ResultadoValidacion {
  /** `true` si el envío puede iniciarse. */
  valido: boolean;
  /** Ruta con puntos del primer campo inválido (si `valido` es `false`). */
  campoInvalido?: string;
  /** Mensaje legible que identifica el problema (si `valido` es `false`). */
  mensaje?: string;
}

/** Un resultado válido reutilizable. */
const OK: ResultadoValidacion = { valido: true };

/** Construye un resultado inválido para un campo dado. */
function invalido(campo: string, mensaje: string): ResultadoValidacion {
  return { valido: false, campoInvalido: campo, mensaje };
}

/**
 * Valida el orden de clips vigente: debe contener entre 1 y
 * {@link MAX_CLIPS_POR_JOB} identificadores (Req 2.3, 9.5, 10.2).
 */
export function validarOrdenClips(ordenClips: string[]): ResultadoValidacion {
  if (!Array.isArray(ordenClips) || ordenClips.length === 0) {
    return invalido(
      'orden_clips',
      'Debes agregar al menos un clip antes de procesar.',
    );
  }
  if (ordenClips.length > MAX_CLIPS_POR_JOB) {
    return invalido(
      'orden_clips',
      `El número de clips (${ordenClips.length}) supera el máximo de ${MAX_CLIPS_POR_JOB}.`,
    );
  }
  return OK;
}

/** Descriptores de los campos numéricos a validar contra {@link RANGOS_UI}. */
const CAMPOS_NUMERICOS: ReadonlyArray<{
  campo: CampoRango;
  etiqueta: string;
  leer: (a: Ajustes) => number;
}> = [
  {
    campo: 'generales.resolucion.ancho',
    etiqueta: 'Ancho de la resolución',
    leer: (a) => a.generales.resolucion.ancho,
  },
  {
    campo: 'generales.resolucion.alto',
    etiqueta: 'Alto de la resolución',
    leer: (a) => a.generales.resolucion.alto,
  },
  {
    campo: 'generales.fps',
    etiqueta: 'Cuadros por segundo',
    leer: (a) => a.generales.fps,
  },
  {
    campo: 'silencios.umbral_db',
    etiqueta: 'Umbral de silencio',
    leer: (a) => a.silencios.umbral_db,
  },
  {
    campo: 'silencios.margen_ms',
    etiqueta: 'Margen de silencio',
    leer: (a) => a.silencios.margen_ms,
  },
  {
    campo: 'silencios.min_silencio_ms',
    etiqueta: 'Duración mínima de silencio',
    leer: (a) => a.silencios.min_silencio_ms,
  },
  {
    campo: 'subtitulos.pos_vertical_pct',
    etiqueta: 'Posición vertical del subtítulo',
    leer: (a) => a.subtitulos.pos_vertical_pct,
  },
  {
    campo: 'subtitulos.pos_horizontal_pct',
    etiqueta: 'Posición horizontal del subtítulo',
    leer: (a) => a.subtitulos.pos_horizontal_pct,
  },
  {
    campo: 'subtitulos.margen_px',
    etiqueta: 'Margen del subtítulo',
    leer: (a) => a.subtitulos.margen_px,
  },
  {
    campo: 'subtitulos.tamano',
    etiqueta: 'Tamaño de fuente',
    leer: (a) => a.subtitulos.tamano,
  },
  {
    campo: 'subtitulos.grosor_borde',
    etiqueta: 'Grosor del borde',
    leer: (a) => a.subtitulos.grosor_borde,
  },
  {
    campo: 'subtitulos.max_palabras',
    etiqueta: 'Máximo de palabras por subtítulo',
    leer: (a) => a.subtitulos.max_palabras,
  },
  {
    campo: 'subtitulos.anim_entrada_ms',
    etiqueta: 'Animación de entrada',
    leer: (a) => a.subtitulos.anim_entrada_ms,
  },
  {
    campo: 'subtitulos.anim_salida_ms',
    etiqueta: 'Animación de salida',
    leer: (a) => a.subtitulos.anim_salida_ms,
  },
  {
    campo: 'subtitulos.slide_px',
    etiqueta: 'Píxeles de deslizamiento',
    leer: (a) => a.subtitulos.slide_px,
  },
];

/**
 * Valida el conjunto completo de ajustes (Req 9.1-9.4, 9.6). Devuelve el primer
 * campo inválido encontrado, o un resultado válido si todos están en rango.
 */
export function validarAjustes(ajustes: Ajustes): ResultadoValidacion {
  // Campos numéricos con rango de la UI.
  for (const { campo, etiqueta, leer } of CAMPOS_NUMERICOS) {
    const valor = leer(ajustes);
    if (!numeroEnRango(valor, RANGOS_UI[campo])) {
      const r = RANGOS_UI[campo];
      return invalido(
        campo,
        `El campo "${etiqueta}" debe estar entre ${r.min} y ${r.max}.`,
      );
    }
  }

  // Colores de subtítulos (#RRGGBB).
  if (!colorValido(ajustes.subtitulos.color)) {
    return invalido(
      'subtitulos.color',
      'El color del subtítulo debe tener formato #RRGGBB.',
    );
  }
  if (!colorValido(ajustes.subtitulos.color_borde)) {
    return invalido(
      'subtitulos.color_borde',
      'El color del borde debe tener formato #RRGGBB.',
    );
  }

  // Idioma y modelo de transcripción (conjuntos admitidos).
  if (!idiomaValido(ajustes.transcripcion.idioma)) {
    return invalido(
      'transcripcion.idioma',
      'El idioma de transcripción no está entre los admitidos.',
    );
  }
  if (!modeloValido(ajustes.transcripcion.modelo)) {
    return invalido(
      'transcripcion.modelo',
      'El modelo de transcripción no está entre los admitidos.',
    );
  }

  // Música opcional: solo se valida cuando está presente.
  if (ajustes.musica !== null) {
    if (
      !numeroEnRango(
        ajustes.musica.volumen_base_pct,
        RANGOS_UI['musica.volumen_base_pct'],
      )
    ) {
      const r = RANGOS_UI['musica.volumen_base_pct'];
      return invalido(
        'musica.volumen_base_pct',
        `El volumen base de la música debe estar entre ${r.min} y ${r.max} %.`,
      );
    }
  }

  return OK;
}

/**
 * Validación global previa al envío: combina {@link validarOrdenClips} y
 * {@link validarAjustes}. El orden de clips se comprueba primero.
 */
export function validarProcesamiento(
  ordenClips: string[],
  ajustes: Ajustes,
): ResultadoValidacion {
  const clips = validarOrdenClips(ordenClips);
  if (!clips.valido) return clips;
  return validarAjustes(ajustes);
}
