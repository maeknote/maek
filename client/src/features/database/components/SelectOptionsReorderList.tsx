// SelectOptionsReorderList — reusable drag-to-reorder chip list for select /
// multi-select column options. Used by the table column header menu (Part A)
// and the kanban "Group by" nested flyout (Part B).
//
// Isolated DragDropContext with a distinct type token so it never cross-targets
// the kanban card DnD. Optional onRemove enables the X button per row — Part A
// passes it, Part B omits it (flyout is reorder-only).
//
// The dragged clone is rendered via Droppable.renderClone so it lives in a
// React portal at document.body. This is required here because this list is
// typically mounted inside FloatingMenu, whose `animate-menu-in` transform
// makes it a containing block for `position: fixed` descendants — which would
// otherwise cause @hello-pangea/dnd's drag overlay to position off-screen and
// appear invisible.

import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import {
  DragDropContext,
  Draggable,
  Droppable,
  type DraggableProvided,
  type DraggableStateSnapshot,
  type DropResult
} from '@hello-pangea/dnd'
import { GripVertical, X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

/** Shallow equality for string arrays — used to skip no-op sync renders when
 *  the parent passes a new array ref with identical contents (common after
 *  the authoritative IPC response arrives with the same order we already
 *  applied optimistically). */
function sameOrder(a: string[], b: string[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

const DRAG_TYPE_SELECT_OPTION = 'select-option'

interface SelectOptionsReorderListProps {
  options: string[]
  onReorder: (next: string[]) => void
  /** When provided, each row shows an X delete button. */
  onRemove?: (value: string) => void
  /** Unique id per mount — prevents collision when multiple lists exist
   *  simultaneously (e.g. the kanban Group-by flyout switching columns). */
  droppableId: string
  /** Empty-state copy. Defaults to "No options yet." */
  emptyLabel?: string
}

export function SelectOptionsReorderList({
  options,
  onReorder,
  onRemove,
  droppableId,
  emptyLabel = 'No options yet.'
}: SelectOptionsReorderListProps): ReactElement {
  // Local optimistic mirror of `options`. We render from this so a drop
  // takes effect in the same render as @hello-pangea/dnd's cleanup — without
  // it the library would snap back to the pre-drop order while waiting for
  // the parent's (awaited) updateSchema IPC to land, then re-snap to the
  // final order, which looks like a visual jump.
  const [localOptions, setLocalOptions] = useState(options)

  // Sync when props change (authoritative update lands, OR caller rejects
  // the reorder and props revert to the old order).
  useEffect(() => {
    setLocalOptions((prev) => (sameOrder(prev, options) ? prev : options))
  }, [options])

  const handleDragEnd = (result: DropResult): void => {
    if (!result.destination) return
    const from = result.source.index
    const to = result.destination.index
    if (from === to) return
    const next = [...localOptions]
    const [moved] = next.splice(from, 1)
    if (moved === undefined) return
    next.splice(to, 0, moved)
    setLocalOptions(next)
    onReorder(next)
  }

  if (localOptions.length === 0) {
    return <div className="px-1 text-[11px] text-muted-text">{emptyLabel}</div>
  }

  const renderRow = (
    opt: string,
    provided: DraggableProvided,
    snapshot: DraggableStateSnapshot
  ): ReactNode => (
    <div
      ref={provided.innerRef}
      {...provided.draggableProps}
      className={cn(
        'flex items-center gap-1 rounded-md bg-surface-overlay px-1.5 py-1 text-[11px] text-neutral-ink',
        snapshot.isDragging && 'shadow-md ring-1 ring-black/5'
      )}
    >
      <span
        {...provided.dragHandleProps}
        className="flex h-4 w-4 shrink-0 cursor-grab items-center justify-center text-muted-text hover:text-neutral-ink active:cursor-grabbing"
        aria-label={`Reorder ${opt}`}
      >
        <GripVertical className="h-3 w-3" />
      </span>
      <span className="flex-1 truncate">{opt}</span>
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(opt)}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-text hover:bg-red-500/20 hover:text-red-500"
          aria-label={`Remove option ${opt}`}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  )

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <Droppable
        droppableId={droppableId}
        type={DRAG_TYPE_SELECT_OPTION}
        renderClone={(provided, snapshot, rubric) => {
          const opt = localOptions[rubric.source.index] ?? ""
          return renderRow(opt, provided, snapshot)
        }}
      >
        {(dropProvided) => (
          <div
            ref={dropProvided.innerRef}
            {...dropProvided.droppableProps}
            className="flex flex-col gap-1 px-1"
          >
            {localOptions.map((opt, idx) => (
              <Draggable key={opt} draggableId={opt} index={idx}>
                {(dragProvided, dragSnapshot) => renderRow(opt, dragProvided, dragSnapshot)}
              </Draggable>
            ))}
            {dropProvided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  )
}
