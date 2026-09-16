// KanbanCard — single draggable card. Pure presentation + hover actions +
// inline property editing.
//
// Drag mechanics are owned by @hello-pangea/dnd via the <Draggable> wrapper
// passed in from KanbanLane. Inline edit triggers are wrapped in <button>
// or <input>, which @hello-pangea/dnd ignores for drag initiation, so
// click-to-edit never starts a drag accidentally. Lane additionally sets
// isDragDisabled while this card has an open editor.

import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement
} from 'react'
import { Check, ExternalLink, GripHorizontal, Maximize2, Minus } from 'lucide-react'
import type { DraggableProvided, DraggableStateSnapshot } from '@hello-pangea/dnd'
import type { DatabaseColumnSchema, DatabaseRow } from '@shared/database'
import { cn } from '@renderer/lib/utils'
import { coerceBoolean, coerceList, formatDisplay, isEmpty } from '../utils/cellFormat'
import { KanbanCardFieldEditor } from './KanbanCardFieldEditor'

interface KanbanCardProps {
  row: DatabaseRow
  previewColumns: DatabaseColumnSchema[]
  provided: DraggableProvided
  snapshot: DraggableStateSnapshot
  onOpenAsPage: (row: DatabaseRow) => void
  onOpenInPopup: (row: DatabaseRow) => void
  onContextMenu?: (e: MouseEvent) => void
  /** Persist a property value change. */
  onUpdateCell?: (rowId: string, columnName: string, value: unknown) => void
  /** Append a new option to a select / multi-select column. */
  onAddColumnOption?: (columnId: string, newOption: string) => void
  /** Persist a title (file name) rename. */
  onRenameRow?: (rowId: string, newTitle: string) => void
  /** Notify parent when this card enters or leaves any edit state (so the
   *  Draggable can be marked isDragDisabled). */
  onEditingChange?: (rowId: string, isEditing: boolean) => void
}

function rowTitle(fileName: string): string {
  return fileName.endsWith('.md') ? fileName.slice(0, -3) : fileName
}

type PreviewKind = 'chip' | 'text' | 'chip-list' | 'boolean'

interface PreviewField {
  column: DatabaseColumnSchema
  kind: PreviewKind
  display?: string
  items?: string[]
  checked?: boolean
  isEmpty?: boolean
}

function placeholderPreviewValue(col: DatabaseColumnSchema): {
  display?: string
  items?: string[]
} {
  switch (col.type) {
    case 'number': {
      const sample =
        col.numberFormat === 'percent' ? 0.42 : col.numberFormat === 'currency-krw' ? 120000 : 1200
      return { display: formatDisplay(col, sample) || '1,200' }
    }
    case 'boolean':
      return { display: 'False' }
    case 'date':
      return { display: '2026-05-07' }
    case 'date-range':
      return { display: '2026-05-07 → 2026-05-14' }
    case 'select':
      return { display: col.options?.[0] ?? 'Option' }
    case 'multi-select': {
      const options = col.options?.slice(0, 2) ?? []
      return { items: options.length > 0 ? options : ['Tag'] }
    }
    case 'list':
      return { display: 'Item, Next' }
    case 'text':
    default:
      return { display: 'Text' }
  }
}

function buildPreviewField(
  row: DatabaseRow,
  col: DatabaseColumnSchema,
  includeEmpty: boolean
): PreviewField | null {
  const raw = row.yamlData[col.name]
  const empty = isEmpty(raw, col.type)
  if (empty && !includeEmpty) return null

  if (col.type === 'select') {
    const text = formatDisplay(col, raw)
    if (!text && !includeEmpty) return null
    const placeholder = empty ? placeholderPreviewValue(col) : {}
    return {
      column: col,
      kind: 'chip',
      display: text || placeholder.display,
      isEmpty: empty
    }
  }

  if (col.type === 'multi-select') {
    const items = coerceList(raw)
    if (items.length === 0 && !includeEmpty) return null
    const placeholder = empty ? placeholderPreviewValue(col) : {}
    return {
      column: col,
      kind: 'chip-list',
      items: items.length > 0 ? items : placeholder.items,
      isEmpty: empty
    }
  }

  if (col.type === 'boolean') {
    const placeholder = empty ? placeholderPreviewValue(col) : {}
    return {
      column: col,
      kind: 'boolean',
      checked: coerceBoolean(raw),
      display: placeholder.display,
      isEmpty: empty
    }
  }

  const text = formatDisplay(col, raw)
  if (!text && !includeEmpty) return null
  const placeholder = empty ? placeholderPreviewValue(col) : {}
  return { column: col, kind: 'text', display: text || placeholder.display, isEmpty: empty }
}

function buildPreviews(row: DatabaseRow, previewColumns: DatabaseColumnSchema[]): PreviewField[] {
  return previewColumns
    .map((col) => buildPreviewField(row, col, false))
    .filter((field): field is PreviewField => field !== null)
}

export function KanbanCard({
  row,
  previewColumns,
  provided,
  snapshot,
  onOpenAsPage,
  onOpenInPopup,
  onContextMenu,
  onUpdateCell,
  onAddColumnOption,
  onRenameRow,
  onEditingChange
}: KanbanCardProps): ReactElement {
  const previews = buildPreviews(row, previewColumns)
  const emptyPreviewColumns = previewColumns.filter((col) =>
    isEmpty(row.yamlData[col.name], col.type)
  )

  const [editingFieldId, setEditingFieldId] = useState<string | null>(null)
  const [showAddControls, setShowAddControls] = useState(false)
  const fieldAnchorRefs = useRef(new Map<string, HTMLButtonElement | null>())
  const cardRef = useRef<HTMLDivElement | null>(null)

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)

  const isEditing = editingFieldId !== null || editingTitle
  useEffect(() => {
    onEditingChange?.(row.id, isEditing)
  }, [isEditing, row.id, onEditingChange])

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.focus()
  }, [editingTitle])

  const startTitleEdit = (): void => {
    setTitleDraft(rowTitle(row.fileName))
    setEditingFieldId(null)
    setShowAddControls(true)
    setEditingTitle(true)
  }
  const commitTitle = (): void => {
    const next = titleDraft.trim() || 'Untitled'
    if (next !== rowTitle(row.fileName)) onRenameRow?.(row.id, next)
    setEditingTitle(false)
    window.setTimeout(() => {
      if (!cardRef.current?.contains(document.activeElement)) setShowAddControls(false)
    }, 0)
  }
  const cancelTitle = (): void => {
    setEditingTitle(false)
    setShowAddControls(false)
  }
  const onTitleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      commitTitle()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelTitle()
    }
  }

  const editingField = editingFieldId
    ? (previewColumns.find((c) => c.id === editingFieldId) ?? null)
    : null
  const shouldShowAddControls = showAddControls || editingTitle || editingFieldId !== null
  const emptyPreviews = shouldShowAddControls
    ? emptyPreviewColumns
        .map((col) => buildPreviewField(row, col, true))
        .filter((field): field is PreviewField => field !== null)
    : []

  const openFieldEditor = (columnId: string): void => {
    setShowAddControls(true)
    setEditingFieldId(columnId)
  }

  const showOnlyAddControls = (): void => {
    setEditingFieldId(null)
    setShowAddControls(true)
  }

  const handleCardBlur = (e: FocusEvent<HTMLDivElement>): void => {
    const nextFocused = e.relatedTarget as Node | null
    if (nextFocused && e.currentTarget.contains(nextFocused)) return
    if (editingFieldId === null && !editingTitle) setShowAddControls(false)
  }

  const setCardNode = (node: HTMLDivElement | null): void => {
    cardRef.current = node
    provided.innerRef(node)
  }

  return (
    <div
      ref={setCardNode}
      {...provided.draggableProps}
      onContextMenu={onContextMenu}
      onBlur={handleCardBlur}
      className={cn(
        'group/card relative rounded-lg border border-[var(--glass-border)] bg-surface p-3',
        'hover:border-[var(--color-input-border-focus)] hover:shadow-sm',
        'min-w-0 select-none',
        snapshot.isDragging && 'shadow-lg ring-1 ring-[var(--color-input-border-focus)]'
      )}
    >
      {/* Top-center drag handle. The card body is no longer the drag source —
          the inline title/property editors used to swallow drag attempts on
          most of the card. The handle is shown on hover and exposes the
          `dragHandleProps` so the user has an unambiguous spot to grab. */}
      <div
        {...provided.dragHandleProps}
        aria-label="Drag card"
        className={cn(
          'absolute top-0.5 left-1/2 -translate-x-1/2 flex h-4 w-7 items-center justify-center',
          'rounded-md text-muted-text/70 hover:bg-surface-overlay hover:text-neutral-ink',
          'cursor-grab active:cursor-grabbing transition-opacity',
          'opacity-0 group-hover/card:opacity-100',
          snapshot.isDragging && 'opacity-100'
        )}
      >
        <GripHorizontal className="h-3 w-3" />
      </div>
      <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 pointer-events-none group-hover/card:opacity-100 group-hover/card:pointer-events-auto transition-opacity">
        <div className="group/btn relative">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onOpenAsPage(row)
            }}
            className="title-cell-action-btn"
            aria-label="Open in new tab"
          >
            <ExternalLink className="h-3 w-3" />
          </button>
          <span className="pointer-events-none absolute top-full left-1/2 z-10 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-neutral-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover/btn:opacity-100 dark:bg-neutral-700">
            Open in new tab
          </span>
        </div>
        <div className="group/btn relative">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onOpenInPopup(row)
            }}
            className="title-cell-action-btn"
            aria-label="Open in center peek"
          >
            <Maximize2 className="h-3 w-3" />
          </button>
          <span className="pointer-events-none absolute top-full left-1/2 z-10 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-neutral-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover/btn:opacity-100 dark:bg-neutral-700">
            Open in center peek
          </span>
        </div>
      </div>

      {editingTitle ? (
        <input
          ref={titleInputRef}
          type="text"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={onTitleKeyDown}
          onClick={(e) => e.stopPropagation()}
          className="w-full pr-12 rounded-sm border border-[var(--color-input-border-focus)] bg-[var(--color-input-bg)] px-1.5 py-0.5 text-sm font-medium text-neutral-ink outline-none"
          spellCheck={false}
        />
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            if (onRenameRow) startTitleEdit()
          }}
          className={cn(
            'block w-full pr-12 text-left text-sm font-medium text-neutral-ink truncate rounded-sm',
            onRenameRow && 'hover:bg-surface-overlay/60 transition-colors'
          )}
        >
          {rowTitle(row.fileName)}
        </button>
      )}

      {previews.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1">
          {previews.map((p) => {
            const col = p.column
            const canShowAddArea = onUpdateCell && emptyPreviewColumns.length > 0

            if (p.kind === 'boolean') {
              const checked = p.checked ?? false
              return (
                <div key={col.id} className="flex items-start gap-1">
                  <button
                    type="button"
                    ref={(el) => {
                      fieldAnchorRefs.current.set(col.id, el)
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (onUpdateCell) openFieldEditor(col.id)
                    }}
                    className={cn(
                      'inline-flex max-w-full items-center gap-1 rounded-sm px-1 py-0.5 text-xs text-muted-text text-left',
                      onUpdateCell && 'hover:bg-surface-overlay/60 transition-colors'
                    )}
                    aria-pressed={checked}
                  >
                    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-default bg-surface-overlay text-neutral-ink">
                      {checked ? <Check className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                    </span>
                    <span className="truncate">{col.name}</span>
                  </button>
                  {canShowAddArea && (
                    <button
                      type="button"
                      aria-label="Show empty properties"
                      onClick={(e) => {
                        e.stopPropagation()
                        showOnlyAddControls()
                      }}
                      className="min-h-6 flex-1 rounded-sm hover:bg-surface-overlay/40 transition-colors"
                    />
                  )}
                </div>
              )
            }

            return (
              <div key={col.id} className="flex items-start gap-1">
                <button
                  type="button"
                  ref={(el) => {
                    fieldAnchorRefs.current.set(col.id, el)
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (onUpdateCell) openFieldEditor(col.id)
                  }}
                  className={cn(
                    'min-w-0 w-fit max-w-full text-left rounded-sm px-1 py-0.5',
                    onUpdateCell && 'hover:bg-surface-overlay/60 transition-colors'
                  )}
                >
                  {p.kind === 'chip' && (
                    <span className="inline-flex max-w-full items-center rounded-full bg-surface-overlay px-2 py-0.5 text-[11px] text-neutral-ink truncate">
                      {p.display}
                    </span>
                  )}
                  {p.kind === 'chip-list' && (
                    <div className="flex max-w-full flex-wrap gap-1 min-w-0">
                      {p.items!.map((item, idx) => (
                        <span
                          key={`${col.id}-${idx}`}
                          className="inline-flex max-w-full items-center rounded-full bg-surface-overlay px-2 py-0.5 text-[11px] text-neutral-ink truncate"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  )}
                  {p.kind === 'text' && (
                    <p className="max-w-full text-xs text-muted-text truncate">{p.display}</p>
                  )}
                </button>
                {canShowAddArea && (
                  <button
                    type="button"
                    aria-label="Show empty properties"
                    onClick={(e) => {
                      e.stopPropagation()
                      showOnlyAddControls()
                    }}
                    className="min-h-6 flex-1 rounded-sm hover:bg-surface-overlay/40 transition-colors"
                  />
                )}
              </div>
            )
          })}
        </div>
      )}

      {onUpdateCell && emptyPreviews.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1">
          {emptyPreviews.map((p) => {
            const col = p.column

            if (p.kind === 'boolean') {
              return (
                <button
                  key={col.id}
                  type="button"
                  ref={(el) => {
                    fieldAnchorRefs.current.set(col.id, el)
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    openFieldEditor(col.id)
                  }}
                  className="inline-flex max-w-full items-center gap-1 rounded-sm px-1 py-0.5 text-xs text-muted-text text-left hover:bg-surface-overlay/60 transition-colors"
                  aria-pressed={false}
                >
                  <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-default bg-surface-overlay text-neutral-ink">
                    <Minus className="h-3 w-3" />
                  </span>
                  <span className="truncate italic text-muted-text/80">
                    {p.display ?? col.name}
                  </span>
                </button>
              )
            }

            return (
              <button
                key={col.id}
                type="button"
                ref={(el) => {
                  fieldAnchorRefs.current.set(col.id, el)
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  openFieldEditor(col.id)
                }}
                className="min-w-0 w-fit max-w-full text-left rounded-sm px-1 py-0.5 hover:bg-surface-overlay/60 transition-colors"
                aria-label={`Edit ${col.name}`}
              >
                {p.kind === 'chip' && (
                  <span className="inline-flex max-w-full items-center rounded-full bg-surface-overlay px-2 py-0.5 text-[11px] italic text-muted-text/80 truncate">
                    {p.display}
                  </span>
                )}
                {p.kind === 'chip-list' && (
                  <div className="flex max-w-full flex-wrap gap-1 min-w-0">
                    {p.items!.map((item, idx) => (
                      <span
                        key={`${col.id}-placeholder-${idx}`}
                        className="inline-flex max-w-full items-center rounded-full bg-surface-overlay px-2 py-0.5 text-[11px] italic text-muted-text/80 truncate"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                )}
                {p.kind === 'text' && (
                  <p className="max-w-full text-xs italic text-muted-text/80 truncate">
                    {p.display}
                  </p>
                )}
              </button>
            )
          })}
        </div>
      )}

      {editingField && onUpdateCell && (
        <KanbanCardFieldEditor
          column={editingField}
          value={row.yamlData[editingField.name]}
          anchorRef={{
            get current() {
              return fieldAnchorRefs.current.get(editingField.id) ?? null
            }
          }}
          onCommit={(next) => onUpdateCell(row.id, editingField.name, next)}
          onClose={() => {
            setEditingFieldId(null)
            setShowAddControls(false)
          }}
          onAddOption={
            onAddColumnOption
              ? (newOption) => onAddColumnOption(editingField.id, newOption)
              : undefined
          }
        />
      )}
    </div>
  )
}
