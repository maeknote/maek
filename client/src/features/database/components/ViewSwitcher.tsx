import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement
} from 'react'
import {
  Calendar,
  Columns3,
  GanttChart,
  MoreHorizontal,
  Pencil,
  Plus,
  Table,
  Trash2
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import {
  FloatingMenu,
  MenuItem,
  MenuSeparator,
  type FloatingMenuPosition
} from '@renderer/shared/components'
import type { DatabaseCustomViewType, DatabaseViewDefinition } from '@shared/database'

interface ViewSwitcherProps {
  views: DatabaseViewDefinition[]
  activeViewId: string
  onViewChange: (viewId: string) => void
  onCreateView: (type: DatabaseCustomViewType) => void
  onRenameView: (viewId: string, name: string) => void
  onDeleteView: (viewId: string) => void
}

interface ViewOption {
  type: DatabaseCustomViewType
  label: string
  icon: ReactElement
}

const VIEW_OPTIONS: ViewOption[] = [
  { type: 'table', label: 'Table', icon: <Table className="h-3.5 w-3.5" /> },
  { type: 'kanban', label: 'Kanban', icon: <Columns3 className="h-3.5 w-3.5" /> },
  { type: 'timeline', label: 'Timeline', icon: <GanttChart className="h-3.5 w-3.5" /> },
  { type: 'calendar', label: 'Calendar', icon: <Calendar className="h-3.5 w-3.5" /> }
]

function viewIcon(type: DatabaseCustomViewType): ReactElement {
  return (
    VIEW_OPTIONS.find((option) => option.type === type)?.icon ?? <Table className="h-3.5 w-3.5" />
  )
}

export function ViewSwitcher({
  views,
  activeViewId,
  onViewChange,
  onCreateView,
  onRenameView,
  onDeleteView
}: ViewSwitcherProps): ReactElement {
  const [addMenuPosition, setAddMenuPosition] = useState<FloatingMenuPosition | null>(null)
  const [viewMenu, setViewMenu] = useState<{
    viewId: string
    position: FloatingMenuPosition
  } | null>(null)
  const [editingViewId, setEditingViewId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const renameFinishedRef = useRef(false)

  const editingView = views.find((view) => view.id === editingViewId)
  const menuView = views.find((view) => view.id === viewMenu?.viewId)

  useEffect(() => {
    if (editingViewId) inputRef.current?.focus()
  }, [editingViewId])

  const openAddMenu = useCallback(() => {
    const rect = addButtonRef.current?.getBoundingClientRect()
    if (!rect) return
    setAddMenuPosition({ x: rect.left, y: rect.bottom })
  }, [])

  const openViewMenu = useCallback((event: MouseEvent<HTMLButtonElement>, viewId: string) => {
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    setViewMenu({ viewId, position: { x: rect.left, y: rect.bottom } })
  }, [])

  const beginRename = useCallback(() => {
    if (!menuView) return
    renameFinishedRef.current = false
    setEditingViewId(menuView.id)
    setDraftName(menuView.name)
    setViewMenu(null)
  }, [menuView])

  const commitRename = useCallback(() => {
    if (!editingView) return
    if (renameFinishedRef.current) return
    renameFinishedRef.current = true
    const nextName = draftName.trim()
    setEditingViewId(null)
    setDraftName('')
    if (nextName.length > 0 && nextName !== editingView.name) {
      onRenameView(editingView.id, nextName)
    }
  }, [draftName, editingView, onRenameView])

  const cancelRename = useCallback(() => {
    renameFinishedRef.current = true
    setEditingViewId(null)
    setDraftName('')
  }, [])

  const handleRenameKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        commitRename()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        cancelRename()
      }
    },
    [cancelRename, commitRename]
  )

  const handleDelete = useCallback(() => {
    if (!menuView || views.length <= 1) return
    onDeleteView(menuView.id)
    setViewMenu(null)
  }, [menuView, onDeleteView, views.length])

  return (
    <div className="flex items-center gap-0.5 px-3 pb-0.5 pt-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        {views.map((view) => {
          const isActive = view.id === activeViewId
          return (
            <div
              key={view.id}
              className={cn(
                'group flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors',
                isActive
                  ? 'bg-surface-overlay text-neutral-ink'
                  : 'text-muted-text hover:bg-surface-overlay/50 hover:text-neutral-ink'
              )}
            >
              {editingViewId === view.id ? (
                <div className="flex min-w-0 items-center gap-1.5">
                  {viewIcon(view.type)}
                  <input
                    ref={inputRef}
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={handleRenameKeyDown}
                    onBlur={commitRename}
                    className="h-5 w-24 rounded border border-border-subtle bg-surface px-1 text-xs text-neutral-ink outline-none"
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onViewChange(view.id)}
                  className="flex min-w-0 items-center gap-1.5"
                >
                  {viewIcon(view.type)}
                  <span className="max-w-32 truncate">{view.name}</span>
                </button>
              )}
              {editingViewId !== view.id && (
                <button
                  type="button"
                  aria-label={`View actions for ${view.name}`}
                  onClick={(event) => openViewMenu(event, view.id)}
                  className={cn(
                    'rounded p-0.5 text-muted-text opacity-0 transition-opacity hover:bg-surface hover:text-neutral-ink group-hover:opacity-100',
                    isActive && 'opacity-100'
                  )}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )
        })}
        <button
          ref={addButtonRef}
          type="button"
          aria-label="Add view"
          onClick={() => (addMenuPosition ? setAddMenuPosition(null) : openAddMenu())}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-text transition-colors hover:bg-surface-overlay/50 hover:text-neutral-ink"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <FloatingMenu
        isOpen={!!addMenuPosition}
        position={addMenuPosition}
        onClose={() => setAddMenuPosition(null)}
        anchorRef={addButtonRef}
      >
        {VIEW_OPTIONS.map((option) => (
          <MenuItem
            key={option.type}
            icon={option.icon}
            label={option.label}
            onClick={() => {
              onCreateView(option.type)
              setAddMenuPosition(null)
            }}
          />
        ))}
      </FloatingMenu>

      <FloatingMenu
        isOpen={!!viewMenu}
        position={viewMenu?.position ?? null}
        onClose={() => setViewMenu(null)}
      >
        <MenuItem icon={<Pencil className="h-3.5 w-3.5" />} label="Rename" onClick={beginRename} />
        <MenuSeparator />
        <MenuItem
          icon={<Trash2 className="h-3.5 w-3.5" />}
          label="Delete"
          destructive
          disabled={views.length <= 1}
          onClick={handleDelete}
        />
      </FloatingMenu>
    </div>
  )
}
