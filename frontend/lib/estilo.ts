/**
 * Proyección pura entre los ajustes de subtítulos del backend
 * (`AjustesSubtitulos`, con nombres `snake_case`) y el `Estilo` visual que
 * consume la composición Remotion (`camelCase`).
 *
 * Estas utilidades extraen el patrón ya presente en `/playground`
 * (`frontend/app/playground/page.tsx`): el `useEffect` de precarga proyecta
 * `ajustes.subtitulos` → `Estilo`, y `guardarEstilo` proyecta `Estilo` sobre una
 * copia de `ajustes.subtitulos`. Se centralizan aquí para reutilizarlas tanto en
 * el playground (refactor de la tarea 4) como en `PreviewRemotionReal`
 * (tarea 5), garantizando una única fuente de verdad de la proyección.
 *
 * Solo intervienen los campos de ESTILO (fuente, tamaño, colores, posición
 * vertical, animación de entrada, borde y negrita). El resto de `AjustesSubtitulos`
 * y del resto de `Ajustes` se conserva intacto.
 *
 * Ambas funciones son **puras**: no mutan sus entradas.
 *
 * Propiedad de round-trip (P4 del diseño), verificada en la PBT de la tarea 2.4:
 *   `estiloDesdeAjustes(ajustesConEstilo(base, e).subtitulos)` es igual a `e`
 *   para todos los campos de estilo.
 */

import type { Estilo } from '@/components/remotion/types';
import type { Ajustes, AjustesSubtitulos } from './types';

/**
 * Proyecta los campos de estilo de `AjustesSubtitulos` (backend, `snake_case`)
 * al tipo `Estilo` de la composición Remotion (`camelCase`).
 *
 * Es la misma proyección que hace el `useEffect` de precarga del playground.
 *
 * @param subtitulos Ajustes de subtítulos de la configuración del backend.
 * @returns El estilo visual equivalente para la composición.
 */
export function estiloDesdeAjustes(subtitulos: AjustesSubtitulos): Estilo {
  return {
    fuente: subtitulos.fuente,
    tamano: subtitulos.tamano,
    color: subtitulos.color,
    colorResaltado: subtitulos.color_resaltado,
    posVerticalPct: subtitulos.pos_vertical_pct,
    animEntradaMs: subtitulos.anim_entrada_ms,
    colorBorde: subtitulos.color_borde,
    grosorBorde: subtitulos.grosor_borde,
    negrita: subtitulos.negrita,
  };
}

/**
 * Devuelve una copia inmutable de `base` con `subtitulos` actualizado a partir
 * de los campos de `estilo`. Los demás ajustes (generales, silencios, etc.) y
 * los campos de `subtitulos` que no son de estilo se conservan sin cambios.
 *
 * Es la misma proyección que hace `guardarEstilo` del playground antes de
 * `PUT /configuracion`.
 *
 * No muta `base` (ni su `subtitulos`): usa propagación (`spread`) para crear
 * nuevos objetos.
 *
 * @param base Ajustes vigentes (o por defecto) sobre los que aplicar el estilo.
 * @param estilo Estilo visual actual a persistir.
 * @returns Una nueva instancia de `Ajustes` con el estilo aplicado.
 */
export function ajustesConEstilo(base: Ajustes, estilo: Estilo): Ajustes {
  return {
    ...base,
    subtitulos: {
      ...base.subtitulos,
      color: estilo.color,
      color_resaltado: estilo.colorResaltado,
      tamano: estilo.tamano,
      fuente: estilo.fuente,
      pos_vertical_pct: estilo.posVerticalPct,
      anim_entrada_ms: estilo.animEntradaMs,
      color_borde: estilo.colorBorde,
      grosor_borde: estilo.grosorBorde,
      negrita: estilo.negrita,
    },
  };
}


// ---------------------------------------------------------------------------
// Proyección HERMANA para el estilo INDEPENDIENTE de los textos extra ("hook")
// (spec edicion-avanzada-shorts, Req 10, 15.5; design §6.2).
//
// Los textos extra tienen su propio estilo, desacoplado del de los subtítulos,
// pero con los MISMOS tipos de control (fuente, tamaño, colores, borde, negrita
// y posiciones vertical/horizontal). A diferencia de la proyección de
// subtítulos —donde el backend usa `snake_case` (`AjustesSubtitulos`) y la
// composición `camelCase` (`Estilo`)—, aquí ambas representaciones ya están en
// `camelCase` y comparten forma (`EstiloTextoExtra`). Aun así se mantienen dos
// funciones espejo de `estiloDesdeAjustes` / `ajustesConEstilo` para:
//   1) tener una única fuente de verdad de la proyección del texto extra, y
//   2) conservar el mismo patrón e idempotencia de round-trip.
//
// RANGOS DEL MOTOR (documentados, no forzados aquí): `tamano` 12..200,
// `grosorBorde` 0..20, `posVerticalPct`/`posHorizontalPct` 0..100 y colores
// `#RRGGBB`. La proyección NO recorta ni valida: es un copiado puro de campos
// que respeta los valores válidos sin alterarlos. La validación fuerte vive en
// el backend (`models/settings.py: validar_texto_extra`, design §6.1/§7.3), de
// modo que la propiedad de round-trip permanece idéntica a la de subtítulos.
//
// Ambas funciones son **puras**: no mutan sus entradas.
//
// Propiedad de round-trip (hermana de P4 del diseño):
//   `estiloTextoExtraDesdeAjustes(ajustesTextoExtra(base, e))` es igual a `e`
//   para todos los campos de estilo.
// ---------------------------------------------------------------------------

import type { EstiloTextoExtra as EstiloTextoExtraComposicion } from '@/components/remotion/types';
import type { EstiloTextoExtra as EstiloTextoExtraBackend } from './types';

/**
 * Proyecta el estilo de un texto extra de la representación del backend
 * (`EstiloTextoExtra` de `lib/types.ts`) al estilo `camelCase` que consume la
 * composición Remotion (`EstiloTextoExtra` de `components/remotion/types.ts`).
 *
 * Es la hermana de `estiloDesdeAjustes` para los textos extra. Copia campo a
 * campo, sin recortar ni validar (los valores válidos se conservan intactos;
 * ver nota de rangos del motor arriba).
 *
 * @param t Estilo del texto extra en la representación del backend/dominio.
 * @returns El estilo equivalente para la composición.
 */
export function estiloTextoExtraDesdeAjustes(
  t: EstiloTextoExtraBackend,
): EstiloTextoExtraComposicion {
  return {
    fuente: t.fuente,
    tamano: t.tamano,
    color: t.color,
    colorBorde: t.colorBorde,
    grosorBorde: t.grosorBorde,
    negrita: t.negrita,
    posVerticalPct: t.posVerticalPct,
    posHorizontalPct: t.posHorizontalPct,
  };
}

/**
 * Devuelve una copia inmutable de `base` con los campos de estilo actualizados
 * a partir de `estilo` (el estilo `camelCase` de la composición). Es la hermana
 * de `ajustesConEstilo` para el estilo INDEPENDIENTE del texto extra.
 *
 * No muta `base`: usa propagación (`spread`) para crear un objeto nuevo. Como
 * el estilo del texto extra no comparte objeto con otros ajustes, `base` aporta
 * la forma/valores previos y `estilo` los sobreescribe; hoy todos los campos
 * son de estilo, por lo que el `spread` de `base` es defensivo ante futuras
 * extensiones del tipo.
 *
 * @param base Estilo vigente (o por defecto) sobre el que aplicar `estilo`.
 * @param estilo Estilo visual actual del texto extra a persistir.
 * @returns Una nueva instancia del estilo del texto extra con el estilo aplicado.
 */
export function ajustesTextoExtra(
  base: EstiloTextoExtraBackend,
  estilo: EstiloTextoExtraComposicion,
): EstiloTextoExtraBackend {
  return {
    ...base,
    fuente: estilo.fuente,
    tamano: estilo.tamano,
    color: estilo.color,
    colorBorde: estilo.colorBorde,
    grosorBorde: estilo.grosorBorde,
    negrita: estilo.negrita,
    posVerticalPct: estilo.posVerticalPct,
    posHorizontalPct: estilo.posHorizontalPct,
  };
}
