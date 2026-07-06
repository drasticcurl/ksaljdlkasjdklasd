'use client';

/**
 * SortableClipItem — Ítem arrastrable de la lista de clips (Req 2).
 *
 * Envuelve un `Clip` con el hook `useSortable` de dnd-kit para hacerlo
 * reordenable dentro de un `SortableContext`. Muestra:
 *   - Su posición actual (1..n) y el nombre original del clip.
 *   - Una indicación visual de destino MIENTRAS se arrastra sobre él
 *     (`isOver`) para señalar dónde se insertará el clip (Req 2.5).
 *   - Retroalimentación visual del propio elemento en arrastre (`isDragging`).
 *
 * Es un componente de presentación: no muta el orden ni contiene la lógica de
 * reordenamiento (esa vive en `lib/reorder.ts` y se dispara en `ClipList.tsx`).
 *
 * Requisitos: 2.5.
 */

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Clip } from '@/lib/types';

export interface SortableClipItemProps {
  /** Clip representado por este ítem. */
  clip: Clip;
  /** Posición visible (1..n) dentro del orden actual. */
  posicion: number;
}

export default function SortableClipItem({
  clip,
  posicion,
}: SortableClipItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: clip.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // El elemento en arrastre se atenúa para distinguirlo del hueco de destino.
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-testid={`clip-item-${clip.id}`}
      data-arrastrando={isDragging ? 'true' : 'false'}
      // Indicador visual de la posición de destino durante el arrastre (Req 2.5).
      data-destino={isOver ? 'true' : 'false'}
      className={[
        'flex items-center gap-3 rounded border bg-gray-800 px-3 py-2 text-sm text-gray-100',
        'cursor-grab select-none active:cursor-grabbing',
        isOver
          ? 'border-blue-400 ring-2 ring-blue-400'
          : 'border-gray-700',
      ].join(' ')}
      {...attributes}
      {...listeners}
    >
      <span
        aria-hidden
        className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-700 text-xs font-semibold"
      >
        {posicion}
      </span>
      <span className="truncate">{clip.nombre_original}</span>
    </li>
  );
}
