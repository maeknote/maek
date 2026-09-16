// DateColumnSelector — toolbar chip used by calendar and timeline views to
// pick which date / date-range column drives the view's layout. Mirrors the
// kanban "Group by" selector pattern.
//
// Behavior:
//   - Always rendered as long as at least one date/date-range column exists.
//   - When `columns.length > 1`: interactive dropdown.
//   - When `columns.length === 1`: read-only chip (no hover, no ChevronDown).
//   - When `columns.length === 0`: caller is expected not to render us (the
//     view itself already shows an empty state).

import { useCallback, useRef, useState, type ReactElement } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { FloatingMenu, type FloatingMenuPosition } from '@renderer/shared/components'
import type { DatabaseColumnSchema } from '@shared/database'

interface DateColumnSelectorProps {
  /** Candidate columns (already filtered to date / date-range types). */
  columns: DatabaseColumnSchema[]
  /** Currently selected column id. */
  currentColumnId: string | null
  /** Called when the user picks a new column. */
  onChange: (columnId: string) => void | Promise<void>
  /** Prefix label; defaults to "Date". */
  label?: string
}

export function DateColumnSelector({
  columns,
  currentColumnId,
  onChange,
  label = 'Date'
}: DateColumnSelectorProps): ReactElement | null {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<FloatingMenuPosition | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const interactive = columns.length > 1

  const openMenu = useCallback(() => {
    if (!interactive) return
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setMenuPos({ x: rect.right, y: rect.bottom })
    }
    setOpen(true)
  }, [interactive])

  const closeMenu = useCallback(() => setOpen(false), [])

  const handlePick = useCallback(
    async (columnId: string) => {
      setOpen(false)
      await onChange(columnId)
    },
    [onChange]
  )

  if (columns.length === 0) return null
  const current = columns.find((c) => c.id === currentColumnId) ?? columns[0]

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? closeMenu() : openMenu())}
        disabled={!interactive}
        className={cn(
          'flex items-center gap-1 px-2 py-0.5 rounded-md text-xs text-muted-text transition-colors',
          interactive ? 'hover:bg-surface-overlay cursor-pointer' : 'cursor-default opacity-90'
        )}
      >
        <span className="opacity-60">{label}:</span>
        <span className="text-neutral-ink font-medium">{current?.name}</span>
        {interactive && <ChevronDown className="w-3 h-3" />}
      </button>

      {interactive && (
        <FloatingMenu
          isOpen={open}
          position={menuPos}
          onClose={closeMenu}
          anchorRef={buttonRef}
          minWidth={180}
        >
          {columns.map((col) => (
            <button
              key={col.id}
              type="button"
              onClick={() => void handlePick(col.id)}
              className={cn(
                'w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs transition-colors',
                col.id === current?.id
                  ? 'text-neutral-ink font-medium bg-surface-overlay'
                  : 'text-muted-text hover:text-neutral-ink hover:bg-surface-overlay'
              )}
            >
              <span className="flex-1 truncate">{col.name}</span>
              <span className="text-[10px] uppercase tracking-wider opacity-60">
                {col.type === 'date-range' ? 'range' : 'date'}
              </span>
            </button>
          ))}
        </FloatingMenu>
      )}
    </>
  )
}
