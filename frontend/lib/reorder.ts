/**
 * Lógica pura de reordenamiento de clips (mover un elemento de la posición i
 * a la posición j), reutilizable por `components/ClipList.tsx` y validable con
 * property-based testing (ver `lib/__tests__/reorder.test.ts`, Propiedad 4).
 *
 * Estas funciones son puras (sin efectos, sin dnd-kit, sin DOM):
 *   - {@link reordenar} produce la permutación esperada para un movimiento
 *     válido de `desde` a `hasta`, conservando el multiconjunto de elementos.
 *   - Un movimiento inválido (índice fuera de rango, no entero, o `desde ===
 *     hasta`) se trata como identidad: devuelve una copia idéntica de la
 *     entrada. Esto modela la semántica de "arrastre cancelado o soltado fuera
 *     del área válida" (Req 2.6).
 *   - {@link reordenarPorIds} adapta la semántica de dnd-kit (ids de elemento
 *     activo/destino) a {@link reordenar}, devolviendo el orden previo cuando el
 *     arrastre se suelta fuera de un destino válido (`over == null`).
 *
 * Requisitos: 2.2 (nueva secuencia posicional tras un movimiento válido),
 * 2.6 (cancelar/soltar fuera del área conserva el orden previo).
 */

/** Estructura mínima con identidad estable, satisfecha por `Clip`. */
export interface ConId {
  id: string;
}

/** Indica si `indice` es un entero dentro del rango `[0, longitud)`. */
export function indiceEnRango(indice: number, longitud: number): boolean {
  return Number.isInteger(indice) && indice >= 0 && indice < longitud;
}

/**
 * Indica si mover un elemento de `desde` a `hasta` es un movimiento válido para
 * una lista de longitud `longitud`: ambos índices dentro de rango y distintos.
 *
 * Un movimiento con `desde === hasta` no altera el orden, por lo que se trata
 * como no-válido (su resultado es la identidad de todas formas).
 */
export function esMovimientoValido(
  longitud: number,
  desde: number,
  hasta: number,
): boolean {
  return (
    indiceEnRango(desde, longitud) &&
    indiceEnRango(hasta, longitud) &&
    desde !== hasta
  );
}

/**
 * Devuelve una NUEVA lista con el elemento en `desde` movido a la posición
 * `hasta`. El resto de elementos conserva su orden relativo.
 *
 * Garantías (Propiedad 4):
 *   - Para un movimiento válido, `resultado[hasta] === items[desde]` (el
 *     elemento queda exactamente en la posición de destino) y el multiconjunto
 *     de elementos se conserva (misma longitud y mismos elementos).
 *   - Para un movimiento inválido (fuera de rango, no entero o `desde ===
 *     hasta`), devuelve una copia idéntica a `items` (identidad, Req 2.6).
 *
 * Nunca muta la lista de entrada.
 */
export function reordenar<T>(
  items: readonly T[],
  desde: number,
  hasta: number,
): T[] {
  const copia = items.slice();

  // Movimiento inválido o nulo ⇒ identidad (cancelación / fuera de área).
  if (!esMovimientoValido(items.length, desde, hasta)) {
    return copia;
  }

  const [movido] = copia.splice(desde, 1);
  copia.splice(hasta, 0, movido);
  return copia;
}

/**
 * Reordena una lista de elementos identificados por `id` a partir de la
 * información de un `dragEnd` de dnd-kit: el id del elemento arrastrado
 * (`activeId`) y el id del elemento sobre el que se soltó (`overId`).
 *
 * Semántica de identidad (Req 2.6): si `overId` es `null`/`undefined` (arrastre
 * soltado fuera de un destino válido), si coincide con `activeId`, o si alguno
 * de los ids no está presente en la lista, se devuelve una copia con el orden
 * previo sin modificaciones.
 *
 * En caso contrario, mueve el elemento `activeId` a la posición que ocupa
 * `overId`, delegando en {@link reordenar}.
 */
export function reordenarPorIds<T extends ConId>(
  items: readonly T[],
  activeId: string,
  overId: string | null | undefined,
): T[] {
  const copia = items.slice();

  // Soltado fuera de un destino válido o sobre sí mismo ⇒ identidad (Req 2.6).
  if (overId == null || overId === activeId) {
    return copia;
  }

  const desde = items.findIndex((it) => it.id === activeId);
  const hasta = items.findIndex((it) => it.id === overId);

  // Ids desconocidos ⇒ identidad (Req 2.6).
  if (desde === -1 || hasta === -1) {
    return copia;
  }

  return reordenar(items, desde, hasta);
}
