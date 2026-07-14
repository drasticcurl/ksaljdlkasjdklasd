/**
 * Mapeo puro de los grupos de subtítulo del backend (tiempos en **segundos**)
 * al contrato `Grupo` de la composición Remotion (tiempos en **milisegundos**).
 *
 * Este módulo replica, palabra por palabra, el criterio de
 * `mapear_grupo_a_props_grupo` (y su auxiliar `_ms_desde_segundos`) de
 * `backend/app/engine/remotion.py`, de modo que la **previsualización en el
 * navegador** y el **render real (SSR)** produzcan EXACTAMENTE los mismos
 * `startMs`/`endMs`/`words` (Propiedad de coherencia P1 del diseño).
 *
 * Reglas replicadas del backend:
 *   - `startMs = redondear(inicio_s * 1000)`, `endMs = redondear(fin_s * 1000)`,
 *     garantizando `endMs >= startMs` (si el redondeo invierte el intervalo, se
 *     fija `endMs = startMs`).
 *   - Si el grupo tiene `palabras` no vacías, se emite una entrada por palabra
 *     (texto sin espacios extra); una palabra sin timing (`inicio_s`/`fin_s`
 *     nulos) **hereda** los tiempos del grupo.
 *   - Si el grupo NO tiene `palabras` (ausente, `null` o lista vacía), `words`
 *     queda como lista **vacía**: la composición divide el `text` por espacios
 *     sin resaltado individual.
 *
 * Las funciones son **puras**: no mutan la entrada ni producen efectos.
 *
 * ---------------------------------------------------------------------------
 * DECISIÓN SOBRE EL REDONDEO (coherencia con el backend)
 * ---------------------------------------------------------------------------
 * Python `round()` usa "banker's rounding" (redondeo a la mitad hacia el par
 * más cercano, *round-half-to-even*): `round(0.5) == 0`, `round(1.5) == 2`,
 * `round(2.5) == 2`. En cambio `Math.round()` de JavaScript redondea la mitad
 * hacia arriba (*round-half-up* / hacia +∞): `Math.round(0.5) === 1`,
 * `Math.round(2.5) === 3`, `Math.round(-0.5) === 0`.
 *
 * Esa diferencia SOLO se manifiesta cuando `segundos * 1000` cae exactamente en
 * una mitad exacta (`N + 0.5` ms), es decir para tiempos como `0.0005 s`,
 * `0.0015 s`, etc. Aunque esos casos son poco frecuentes con timestamps reales
 * de transcripción, la Propiedad P1 exige coherencia EXACTA entre preview y
 * render (y la PBT de la tarea 2.4 comparará contra el criterio del backend con
 * tiempos degenerados/aleatorios). Por eso NO usamos `Math.round`: implementamos
 * {@link redondearMitadAPar}, que reproduce el *round-half-to-even* de Python
 * sobre el mismo valor `double`, garantizando resultados idénticos también en
 * los empates y con valores negativos (tiempos invertidos).
 */

import type { Grupo, Palabra } from '@/components/remotion/types';
import type { GrupoSubtituloConPalabras } from './types';

/**
 * Redondea `valor` al entero más cercano usando *round-half-to-even* (banker's
 * rounding), replicando el comportamiento de `round()` de Python para el mismo
 * valor en coma flotante de doble precisión.
 *
 * Los empates exactos (`… .5`) se resuelven hacia el entero **par**:
 *   - `redondearMitadAPar(0.5) === 0`
 *   - `redondearMitadAPar(1.5) === 2`
 *   - `redondearMitadAPar(2.5) === 2`
 *   - `redondearMitadAPar(-0.5) === -0` (equivalente a 0)
 *   - `redondearMitadAPar(-1.5) === -2`
 *
 * La detección del empate es exacta porque las mitades enteras representables
 * (`… .5`) cumplen `valor - Math.floor(valor) === 0.5` sin error de coma
 * flotante hasta 2^52.
 */
export function redondearMitadAPar(valor: number): number {
  const suelo = Math.floor(valor);
  const fraccion = valor - suelo;
  if (fraccion < 0.5) {
    return suelo;
  }
  if (fraccion > 0.5) {
    return suelo + 1;
  }
  // Empate exacto (.5): se redondea hacia el entero par (round-half-to-even).
  return suelo % 2 === 0 ? suelo : suelo + 1;
}

/**
 * Convierte un intervalo en segundos a `[startMs, endMs]` en milisegundos,
 * garantizando el orden `endMs >= startMs`.
 *
 * Réplica exacta de `_ms_desde_segundos` del backend: redondea ambos extremos a
 * ms y, si el redondeo invirtiera el intervalo (`endMs < startMs`), fija
 * `endMs = startMs`.
 */
function msDesdeSegundos(inicioS: number, finS: number): [number, number] {
  const startMs = redondearMitadAPar(inicioS * 1000);
  let endMs = redondearMitadAPar(finS * 1000);
  if (endMs < startMs) {
    endMs = startMs;
  }
  return [startMs, endMs];
}

/**
 * Mapea un grupo del backend (`GrupoSubtituloConPalabras`, segundos) al contrato
 * `Grupo` de la composición Remotion (milisegundos).
 *
 * Réplica exacta de `mapear_grupo_a_props_grupo` de
 * `backend/app/engine/remotion.py`:
 *   - `text` es el texto completo del grupo (sin recortar, igual que el backend).
 *   - `startMs`/`endMs` redondeados con `endMs >= startMs`.
 *   - `words`: una entrada por palabra si el grupo trae `palabras` no vacías
 *     (texto recortado con `trim`; tiempos heredados del grupo si faltan); lista
 *     vacía en caso contrario.
 *
 * Función pura: no muta el grupo ni sus palabras.
 *
 * @param g Grupo de subtítulo del backend (con palabras opcionales).
 * @returns El grupo mapeado al contrato de Remotion.
 */
export function grupoBackendARemotion(g: GrupoSubtituloConPalabras): Grupo {
  const [inicioGrupoMs, finGrupoMs] = msDesdeSegundos(g.inicio_s, g.fin_s);

  const words: Palabra[] = [];
  // `if (grupo.palabras:)` de Python es falso para `None` y para la lista vacía;
  // en JS hay que comprobar también la longitud (un array vacío es *truthy*).
  if (g.palabras && g.palabras.length > 0) {
    for (const palabra of g.palabras) {
      // Una palabra sin timestamps válidos hereda los tiempos del grupo.
      // `??` cubre `null` y `undefined`, conservando el valor `0` (no nulo).
      const inicio = palabra.inicio_s ?? g.inicio_s;
      const fin = palabra.fin_s ?? g.fin_s;
      const [palabraInicioMs, palabraFinMs] = msDesdeSegundos(inicio, fin);
      words.push({
        text: palabra.texto.trim(),
        startMs: palabraInicioMs,
        endMs: palabraFinMs,
      });
    }
  }

  return {
    text: g.texto,
    startMs: inicioGrupoMs,
    endMs: finGrupoMs,
    words,
  };
}

/**
 * Mapea una lista de grupos del backend a la lista de `Grupo` de Remotion.
 *
 * Réplica de `mapear_grupos_a_props_grupos` del backend. Función pura: devuelve
 * una nueva lista sin mutar la entrada.
 */
export function gruposBackendARemotion(
  grupos: readonly GrupoSubtituloConPalabras[],
): Grupo[] {
  return grupos.map(grupoBackendARemotion);
}


/**
 * Deriva `durationInFrames` (duración total de la composición, en frames) a
 * partir de la duración del vídeo y los `fps`, replicando el criterio de
 * `_calcular_duration_in_frames` de `backend/app/engine/remotion.py`
 * (Propiedad de coherencia P2 del diseño).
 *
 * Criterio (mismo que el backend):
 *   - Duración preferente: `duracionS` si es un número finito y **fiable**
 *     (`> 0`). Es el equivalente a que el backend reciba `duracion_s` (o lo
 *     obtenga por inspección del vídeo).
 *   - Fallback: si `duracionS` no es fiable (`<= 0`, `NaN`, `±Infinity`), se usa
 *     el mayor tiempo de fin de los grupos. Los grupos de Remotion llevan `endMs`
 *     en **milisegundos**, así que se divide por 1000 para obtener segundos
 *     (equivalente al `max(fin_s)` en segundos del backend).
 *   - Resultado: `max(1, ceil(duracionSegundos * fps))`. IMPORTANTE: se usa
 *     `ceil` (redondeo hacia arriba), igual que el backend, NO `round`; y nunca
 *     menos de 1 frame.
 *
 * Función pura: no muta la entrada.
 *
 * @param duracionS Duración del vídeo en segundos (0 o negativo => no fiable).
 * @param fps Cuadros por segundo del render (se asume `>= 1`).
 * @param grupos Grupos ya mapeados a Remotion (con `endMs` en ms) para el fallback.
 * @returns El número de frames (>= 1) que debe durar la composición.
 */
export function calcularDurationInFrames(
  duracionS: number,
  fps: number,
  grupos: readonly Grupo[],
): number {
  const duracionFiable = Number.isFinite(duracionS) && duracionS > 0;
  const duracionSegundos = duracionFiable
    ? duracionS
    : mayorFinSegundos(grupos);
  return Math.max(1, Math.ceil(duracionSegundos * fps));
}

/**
 * Devuelve el mayor tiempo de fin de los grupos, en **segundos** (a partir del
 * mayor `endMs` en ms). Réplica del `max(fin_s, default=0.0)` del backend: si la
 * lista está vacía, devuelve `0`.
 */
function mayorFinSegundos(grupos: readonly Grupo[]): number {
  let maxEndMs = 0;
  for (const g of grupos) {
    if (g.endMs > maxEndMs) {
      maxEndMs = g.endMs;
    }
  }
  return maxEndMs / 1000;
}
