// LaneColorMenu — popover for a lane header.
// Not part of the DnD tree; purely decorative/persisted via viewConfig.
//
// Sections: "Move" (reorder the lane within column.options) + "Color" (picker).
// UNCATEGORIZED lanes don't render this menu at all — see KanbanLane's
// canCustomize check.

import { useCallback, useRef, useState, type ReactElement } from 'react'
import { ArrowLeft, ArrowRight, MoreHorizontal, Trash2 } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { LANE_COLOR_PRESETS } from './constants'

interface LaneColorMenuProps {
  selectedKey: string | undefined
  onChange: (colorKey: string) => void
  canMoveLeft: boolean
  canMoveRight: boolean
  onMoveLeft: () => void
  onMoveRight: () => void
  onDelete: () => void
}

export function LaneColorMenu({
  selectedKey,
  onChange,
  canMoveLeft,
  canMoveRight,
  onMoveLeft,
  onMoveRight,
  onDelete
}: LaneColorMenuProps): ReactElement {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const toggle = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      // Right-align the popover with the trigger's right edge (button sits in
      // the lane's top-right corner, so opening to the bottom-left keeps the
      // popover within the lane's visual column when possible).
      setMenuPos({ top: rect.bottom + 4, left: rect.right })
    }
    setOpen((v) => !v)
  }, [])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        onContextMenu={(e) => {
          e.preventDefault()
          toggle()
        }}
        draggable={false}
        className={cn(
          'absolute top-1 right-1 z-10 flex items-center justify-center w-5 h-5 rounded transition-opacity text-muted-text hover:bg-surface-overlay hover:text-neutral-ink',
          'opacity-0 group-hover/header:opacity-100'
        )}
        aria-label="Lane options"
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>

      {open && menuPos && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="fixed z-50 -translate-x-full glass-surface menu-container animate-menu-in min-w-[160px] p-2"
            style={{ top: menuPos.top, left: menuPos.left }}
          >
            <div className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-text">
              Move
            </div>
            <div className="flex flex-col gap-0.5">
              <button
                type="button"
                disabled={!canMoveLeft}
                onClick={() => {
                  if (!canMoveLeft) return
                  onMoveLeft()
                  setOpen(false)
                }}
                className={cn(
                  'flex items-center gap-2 px-2 py-1 rounded-md text-xs transition-colors',
                  canMoveLeft
                    ? 'text-muted-text hover:text-neutral-ink hover:bg-surface-overlay'
                    : 'text-muted-text opacity-40 cursor-not-allowed'
                )}
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Move lane left
              </button>
              <button
                type="button"
                disabled={!canMoveRight}
                onClick={() => {
                  if (!canMoveRight) return
                  onMoveRight()
                  setOpen(false)
                }}
                className={cn(
                  'flex items-center gap-2 px-2 py-1 rounded-md text-xs transition-colors',
                  canMoveRight
                    ? 'text-muted-text hover:text-neutral-ink hover:bg-surface-overlay'
                    : 'text-muted-text opacity-40 cursor-not-allowed'
                )}
              >
                <ArrowRight className="w-3.5 h-3.5" />
                Move lane right
              </button>
            </div>

            <div className="my-1.5 border-t border-white/5" />

            <div className="flex flex-col gap-0.5">
              <button
                type="button"
                onClick={() => {
                  onDelete()
                  setOpen(false)
                }}
                className="flex items-center gap-2 px-2 py-1 rounded-md text-xs text-red-500/90 hover:bg-red-500/10 hover:text-red-500 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete lane
              </button>
            </div>

            <div className="my-1.5 border-t border-white/5" />

            <div className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-text">
              Color
            </div>
            <div className="flex flex-col gap-0.5">
              {LANE_COLOR_PRESETS.map((preset) => {
                const isSelected = (selectedKey ?? 'none') === preset.key
                return (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => {
                      onChange(preset.key)
                      setOpen(false)
                    }}
                    className={cn(
                      'flex items-center gap-2 px-2 py-1 rounded-md text-xs transition-colors',
                      isSelected
                        ? 'text-neutral-ink bg-surface-overlay font-medium'
                        : 'text-muted-text hover:text-neutral-ink hover:bg-surface-overlay'
                    )}
                  >
                    <span className={cn('w-3 h-3 rounded-full shrink-0', preset.dot)} />
                    {preset.label}
                    {isSelected && <span className="ml-auto text-[10px] text-muted-text">✓</span>}
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </>
  )
}
