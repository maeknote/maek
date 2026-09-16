import { useRef, useState, type DragEvent, type MouseEvent, type ReactElement } from 'react'
import { FileText, GripVertical, Maximize2, Plus, Trash2 } from 'lucide-react'
import { FloatingMenu, MenuItem, MenuSeparator } from '@renderer/shared/components'
import type { FloatingMenuPosition } from '@renderer/shared/components'

interface RowHandleMenuProps {
  onOpenAsPage: () => void
  onOpenInPopup: () => void
  onInsertAbove: () => void
  onInsertBelow: () => void
  onDelete: () => void
  /** Whether drag is allowed (disabled when a sort rule is active). */
  draggable: boolean
  onDragStart: (e: DragEvent<HTMLButtonElement>) => void
}

export function RowHandleMenu({
  onOpenAsPage,
  onOpenInPopup,
  onInsertAbove,
  onInsertBelow,
  onDelete,
  draggable,
  onDragStart
}: RowHandleMenuProps): ReactElement {
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState<FloatingMenuPosition | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const open = (e: MouseEvent<HTMLButtonElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    setPosition({ x: rect.right + 4, y: rect.top })
    setIsOpen(true)
  }

  const close = (): void => {
    setIsOpen(false)
    setPosition(null)
  }

  const handleAction = (action: () => void) => (): void => {
    close()
    action()
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        draggable={draggable}
        onClick={open}
        onContextMenu={open}
        onDragStart={onDragStart}
        className="mx-auto flex h-6 w-6 items-center justify-center rounded-md text-muted-text opacity-0 transition-opacity hover:bg-surface-overlay hover:text-neutral-ink group-hover:opacity-100 cursor-grab active:cursor-grabbing"
        aria-label="Row options"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      <FloatingMenu
        isOpen={isOpen}
        position={position}
        onClose={close}
        anchorRef={buttonRef}
        minWidth={160}
      >
        <MenuItem
          icon={<FileText className="h-3.5 w-3.5" />}
          label="Open in new tab"
          onClick={handleAction(onOpenAsPage)}
        />
        <MenuItem
          icon={<Maximize2 className="h-3.5 w-3.5" />}
          label="Open in center peek"
          onClick={handleAction(onOpenInPopup)}
        />
        <MenuSeparator />
        <MenuItem
          icon={<Plus className="h-3.5 w-3.5" />}
          label="Insert row above"
          onClick={handleAction(onInsertAbove)}
        />
        <MenuItem
          icon={<Plus className="h-3.5 w-3.5" />}
          label="Insert row below"
          onClick={handleAction(onInsertBelow)}
        />
        <MenuSeparator />
        <MenuItem
          icon={<Trash2 className="h-3.5 w-3.5" />}
          label="Delete"
          destructive
          onClick={handleAction(onDelete)}
        />
      </FloatingMenu>
    </>
  )
}
