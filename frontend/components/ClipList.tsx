'use client';

/**
 * ClipList — Lista reordenable de clips mediante arrastrar y soltar (Req 2).
 *
 * Responsabilidades:
 *   - Presentar los clips en su orden actual (1..n).
 *   - Habilitar el reordenamiento con dnd-kit SOLO cuando existen >= 2 clips
 *     (Req 2.1); con 0 o 1 clip la lista se muestra de forma estática.
 *   - Al soltar un clip en una posición válida distinta de la original,
 *     calcular el nuevo orden con la función pura `reordenar`/`reordenarPorIds`
 *     y notificarlo vía `onOrdenCambiado` (Req 2.2). La actualización es
 *     síncrona (muy por debajo de los 500 ms exigidos).
 *   - Al cancelar el arrastre o soltar fuera de un destino válido, conservar el
 *     orden previo sin modificaciones (Req 2.6): no se invoca `onOrdenCambiado`.
 *   - Delegar el indicador visual de destino a `SortableClipItem` (Req 2.5).
 *
 * La lógica de permutación vive en `lib/reorder.ts` (pura y testeable, ver
 * Propiedad 4). Este componente solo cablea dnd-kit con esa lógica.
 *
 * Requisitos: 2.1, 2.2, 2.5, 2.6.
 */

import { useCallback, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { Clip } from '@/lib/types';
import { reordenarPorIds } from '@/lib/reorder';
import SortableClipItem from './SortableClipItem';

export interface ClipListProps {
  /** Clips en su orden actual (el índice define la posición visible). */
  clips: Clip[];
  /**
   * Se invoca con el NUEVO orden de clips únicamente cuando un arrastre válido
   * modifica la secuencia (Req 2.2). No se invoca en cancelaciones ni cuando el
   * clip se suelta fuera de un destino válido (Req 2.6). Se usará para cablear
   * el `Orden_de_Clips` vigente en la Tarea 20.4.
   */
  onOrdenCambiado?: (clips: Clip[]) => void;
}

export default function ClipList({ clips, onOrdenCambiado }: ClipListProps) {
  /** Id del clip que se está arrastrando (para retroalimentación visual). */
  const [activeId, setActiveId] = useState<string | null>(null);

  // Req 2.1: el reordenamiento se habilita a partir de 2 clips.
  const reordenamientoHabilitado = clips.length >= 2;

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const manejarInicio = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const manejarFin = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);

      const { active, over } = event;
      // `over == null` ⇒ soltado fuera de un destino válido (Req 2.6).
      const overId = over ? String(over.id) : null;

      const nuevoOrden = reordenarPorIds(clips, String(active.id), overId);

      // Solo notificar si el orden efectivamente cambió (Req 2.2); en
      // cancelaciones / soltar fuera, `reordenarPorIds` devuelve el orden
      // previo y no se notifica (Req 2.6).
      const cambio = nuevoOrden.some((clip, i) => clip.id !== clips[i]?.id);
      if (cambio) {
        onOrdenCambiado?.(nuevoOrden);
      }
    },
    [clips, onOrdenCambiado],
  );

  const manejarCancelacion = useCallback(() => {
    // Req 2.6: conservar el orden previo (no se modifica ni se notifica nada).
    setActiveId(null);
  }, []);

  if (clips.length === 0) {
    return (
      <p data-testid="clip-list-vacia" className="text-sm text-gray-400">
        Aún no hay clips. Sube al menos un clip para verlo aquí.
      </p>
    );
  }

  // Con un solo clip no hay reordenamiento posible (Req 2.1): lista estática.
  if (!reordenamientoHabilitado) {
    return (
      <ol
        data-testid="clip-list"
        data-reordenable="false"
        className="flex flex-col gap-2"
      >
        {clips.map((clip, i) => (
          <li
            key={clip.id}
            data-testid={`clip-item-${clip.id}`}
            className="flex items-center gap-3 rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100"
          >
            <span
              aria-hidden
              className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-700 text-xs font-semibold"
            >
              {i + 1}
            </span>
            <span className="truncate">{clip.nombre_original}</span>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={manejarInicio}
      onDragEnd={manejarFin}
      onDragCancel={manejarCancelacion}
    >
      <SortableContext
        items={clips.map((clip) => clip.id)}
        strategy={verticalListSortingStrategy}
      >
        <ol
          data-testid="clip-list"
          data-reordenable="true"
          data-arrastrando={activeId ?? ''}
          className="flex flex-col gap-2"
        >
          {clips.map((clip, i) => (
            <SortableClipItem key={clip.id} clip={clip} posicion={i + 1} />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}
