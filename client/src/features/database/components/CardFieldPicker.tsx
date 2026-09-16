// CardFieldPicker — floating menu that lets the user pick which columns
// appear as preview fields on each kanban card. The row title is always
// shown and is rendered at the top as a disabled, checked row so the user
// knows it's fixed.

import type { ReactElement, RefObject } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { FloatingMenu, type FloatingMenuPosition } from '@renderer/shared/components'
import type { DatabaseColumnSchema } from '@shared/database'

interface CardFieldPickerProps {
  columns: DatabaseColumnSchema[]
  selectedIds: string[]
  onToggle: (columnId: string, on: boolean) => void
  isOpen: boolean
  position: FloatingMenuPosition | null
  onClose: () => void
  anchorRef: RefObject<HTMLElement | null>
}

export function CardFieldPicker({
  columns,
  selectedIds,
  onToggle,
  isOpen,
  position,
  onClose,
  anchorRef
}: CardFieldPickerProps): ReactElement {
  const selected = new Set(selectedIds)

  return (
    <FloatingMenu
      isOpen={isOpen}
      position={position}
      onClose={onClose}
      anchorRef={anchorRef}
      minWidth={220}
    >
      <div className="py-1.5">
        <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-text">
          Card properties
        </div>

        {/* Title row — always shown, fixed. */}
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-text">
          <span className="flex h-3.5 w-3.5 items-center justify-center rounded border border-default bg-surface-overlay text-neutral-ink">
            <Check className="h-3 w-3" />
          </span>
          <span className="flex-1 truncate text-neutral-ink">Title</span>
          <span className="text-[10px] opacity-60">Always shown</span>
        </div>

        {columns.length === 0 ? (
          <div className="px-3 py-2 text-[11px] text-muted-text">No other columns</div>
        ) : (
          columns.map((col) => {
            const on = selected.has(col.id)
            return (
              <button
                key={col.id}
                type="button"
                onClick={() => onToggle(col.id, !on)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
                  'text-neutral-ink hover:bg-surface-overlay'
                )}
                role="menuitemcheckbox"
                aria-checked={on}
              >
                <span
                  className={cn(
                    'flex h-3.5 w-3.5 items-center justify-center rounded border',
                    on ? 'bg-maek-red border-maek-red text-white' : 'border-default bg-surface'
                  )}
                >
                  {on && <Check className="h-3 w-3" />}
                </span>
                <span className="flex-1 truncate">{col.name}</span>
                <span className="text-[10px] opacity-60">{col.type}</span>
              </button>
            )
          })
        )}
      </div>
    </FloatingMenu>
  )
}
