import { useCallback, useState, type MouseEvent, type ReactElement } from 'react'
import { Trash2 } from 'lucide-react'
import { FloatingMenu, MenuItem } from '@renderer/shared/components'
import type { FloatingMenuPosition } from '@renderer/shared/components'

interface RowContextMenuState {
  rowId: string
  position: FloatingMenuPosition
}

interface UseRowContextMenuResult {
  openFor: (rowId: string) => (e: MouseEvent) => void
  menu: ReactElement
}

/**
 * Shared right-click context menu for database rows.
 * Currently exposes a Delete action; additional actions can be added later.
 */
export function useRowContextMenu(onDelete: (rowId: string) => void): UseRowContextMenuResult {
  const [state, setState] = useState<RowContextMenuState | null>(null)

  const openFor = useCallback(
    (rowId: string) =>
      (e: MouseEvent): void => {
        e.preventDefault()
        e.stopPropagation()
        setState({ rowId, position: { x: e.clientX, y: e.clientY } })
      },
    []
  )

  const close = useCallback(() => setState(null), [])

  const menu = (
    <FloatingMenu
      isOpen={state !== null}
      position={state?.position ?? null}
      onClose={close}
      minWidth={160}
    >
      <MenuItem
        icon={<Trash2 className="h-3.5 w-3.5" />}
        label="Delete"
        destructive
        onClick={() => {
          const target = state?.rowId
          close()
          if (target) onDelete(target)
        }}
      />
    </FloatingMenu>
  )

  return { openFor, menu }
}
