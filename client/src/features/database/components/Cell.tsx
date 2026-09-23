// Cell - Renders + edits a single database cell based on its column type.
//
// Kept as a single file with an internal switch to avoid creating 8 tiny cell components.
// Each type has its own inline edit affordance; blur / Enter commits the value.

import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@renderer/lib/utils'
import { useDismissible } from '@renderer/shared/hooks'
import type { DatabaseColumnSchema, DatabaseDateRangeValue } from '@shared/database'
import {
  coerceBoolean,
  coerceDateString,
  coerceList,
  coerceNumber,
  coerceText,
  formatDisplay,
  parseDateRange
} from '../utils/cellFormat'
import { EditorActionRow, MultiSelectOptionList, SelectOptionList } from './cellEditors'

interface CellProps {
  column: DatabaseColumnSchema
  value: unknown
  onCommit: (nextValue: unknown) => void | Promise<void>
  /**
   * Adds a new option to the column's `options` array (select / multi-select only).
   * Wired by the table view so users can create new options inline from the cell editor.
   */
  onAddOption?: (newOption: string) => Promise<void>
}

const INPUT_CLASS =
  'w-full h-full px-2 text-sm text-neutral-ink bg-[var(--color-input-bg)] border border-[var(--color-input-border-focus)] outline-none rounded-sm placeholder:text-muted-text'
const READ_CLASS = 'w-full h-full px-3 py-1.5 text-sm text-neutral-ink truncate'
const READ_CLASS_WRAP =
  'w-full h-full px-3 py-1.5 text-sm text-neutral-ink whitespace-pre-wrap break-words'

/** Render a small read-only chip used by multi-select cell display. */
function ChipBadge({ label }: { label: string }): ReactElement {
  return (
    <span className="inline-flex max-w-full items-center rounded-full bg-surface-overlay px-2 py-0.5 text-[11px] text-neutral-ink">
      <span className="truncate">{label}</span>
    </span>
  )
}

export function Cell({ column, value, onCommit, onAddOption }: CellProps): ReactElement {
  const [isEditing, setIsEditing] = useState(false)
  const commit = useCallback(async (next: unknown): Promise<boolean> => {
    try {
      await onCommit(next)
      return true
    } catch {
      return false
    }
  }, [onCommit])
  const startEdit = useCallback(() => {
    setIsEditing(true)
  }, [])

  // Boolean cells render a real checkbox instead of going through edit mode.
  if (column.type === 'boolean') {
    return (
      <div className="flex h-full items-center justify-center">
        <input
          type="checkbox"
          checked={coerceBoolean(value)}
          onChange={(e) => { void commit(e.target.checked) }}
          className="h-4 w-4 cursor-pointer accent-maek-red"
          aria-label={column.name}
        />
      </div>
    )
  }

  // Multi-select read mode renders each option as a small chip rather than a
  // joined comma-separated string. Editing still goes through MultiSelectEditor.
  if (column.type === 'multi-select' && !isEditing) {
    const items = coerceList(value)
    return (
      <button
        type="button"
        onClick={startEdit}
        className={cn(
          'flex h-full w-full flex-wrap items-center gap-1 px-3 py-1.5 text-left',
          'hover:bg-surface-overlay/60 transition-colors',
          items.length === 0 && 'text-muted-text/50'
        )}
      >
        {items.length === 0 ? (
          <span className="text-sm">—</span>
        ) : (
          items.map((item) => <ChipBadge key={item} label={item} />)
        )}
      </button>
    )
  }

  if (!isEditing) {
    const display = formatDisplay(column, value)
    // Text cells preserve newlines and wrap long content. Other types stay
    // single-line + truncated so dates / numbers / chips don't grow rows.
    const readClass = column.type === 'text' ? READ_CLASS_WRAP : READ_CLASS
    return (
      <button
        type="button"
        onClick={startEdit}
        className={cn(
          readClass,
          'text-left hover:bg-surface-overlay/60 transition-colors',
          display === '' && 'text-muted-text/50'
        )}
      >
        {display === '' ? '—' : display}
      </button>
    )
  }

  switch (column.type) {
    case 'number':
      return <NumberEditor value={value} onCommit={commit} close={() => setIsEditing(false)} />
    case 'date':
      return <DateEditor value={value} onCommit={commit} close={() => setIsEditing(false)} />
    case 'date-range':
      return <DateRangeEditor value={value} onCommit={commit} close={() => setIsEditing(false)} />
    case 'select':
      return (
        <SelectEditor
          column={column}
          value={value}
          onCommit={commit}
          onAddOption={onAddOption}
          close={() => setIsEditing(false)}
        />
      )
    case 'multi-select':
      return (
        <MultiSelectEditor
          column={column}
          value={value}
          onCommit={commit}
          onAddOption={onAddOption}
          close={() => setIsEditing(false)}
        />
      )
    case 'list':
      return <ListEditor value={value} onCommit={commit} close={() => setIsEditing(false)} />
    default:
      return <TextEditor value={value} onCommit={commit} close={() => setIsEditing(false)} />
  }
}

// ========================================
// Editor variants
// ========================================

interface EditorProps {
  value: unknown
  onCommit: (next: unknown) => Promise<boolean>
  close: () => void
}

interface ColumnEditorProps extends EditorProps {
  column: DatabaseColumnSchema
  /** Optional: add a brand-new option to the column when used inside select/multi-select */
  onAddOption?: (newOption: string) => Promise<void>
}

function TextEditor({ value, onCommit, close }: EditorProps): ReactElement {
  const [draft, setDraft] = useState(coerceText(value))
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-grow: match the textarea height to its content on every keystroke
  // so the row expands as the user adds new lines.
  const resize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.focus()
    // Place caret at the end so editing existing content doesn't reset position.
    el.setSelectionRange(el.value.length, el.value.length)
    resize()
  }, [resize])

  const commit = async (): Promise<void> => {
    if (await onCommit(draft)) close()
  }

  return (
    <CellEditorPanel onCommit={commit} onCancel={close}>
      <textarea
        ref={textareaRef}
        rows={1}
        className={cn(
          INPUT_CLASS,
          'min-h-9 py-1.5 resize-none whitespace-pre-wrap break-words leading-5 overflow-hidden'
        )}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          resize()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void commit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            close()
          }
        }}
      />
    </CellEditorPanel>
  )
}

function NumberEditor({ value, onCommit, close }: EditorProps): ReactElement {
  const initial = coerceNumber(value)
  const [draft, setDraft] = useState(initial === null ? '' : String(initial))
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])

  const commit = async (): Promise<void> => {
    if (draft.trim() === '') {
      if (await onCommit(null)) close()
    } else {
      const n = Number(draft)
      if (await onCommit(Number.isFinite(n) ? n : null)) close()
    }
  }

  return (
    <CellEditorPanel onCommit={commit} onCancel={close}>
      <input
        ref={inputRef}
        type="number"
        className={INPUT_CLASS}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) void commit()
          else if (e.key === 'Escape') close()
        }}
      />
    </CellEditorPanel>
  )
}

function DateEditor({ value, onCommit, close }: EditorProps): ReactElement {
  const [draft, setDraft] = useState(coerceDateString(value))
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])

  const commit = async (): Promise<void> => {
    if (await onCommit(draft || '')) close()
  }

  return (
    <CellEditorPanel onCommit={commit} onCancel={close}>
      <input
        ref={inputRef}
        type="date"
        className={INPUT_CLASS}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) void commit()
          else if (e.key === 'Escape') close()
        }}
      />
    </CellEditorPanel>
  )
}

function DateRangeEditor({ value, onCommit, close }: EditorProps): ReactElement {
  const initial = parseDateRange(value)
  const [start, setStart] = useState(initial.start ?? '')
  const [end, setEnd] = useState(initial.end ?? '')

  const commit = async (): Promise<void> => {
    const next: DatabaseDateRangeValue = {
      start: start.trim() === '' ? null : start,
      end: end.trim() === '' ? null : end
    }
    if (await onCommit(next)) close()
  }

  const rangeInputClass =
    'flex-1 h-full px-1.5 text-xs text-neutral-ink bg-[var(--color-input-bg)] border border-[var(--color-input-border-focus)] outline-none rounded-sm'

  return (
    <CellEditorPanel onCommit={commit} onCancel={close} minWidth={300}>
      <div className="flex items-center gap-1">
        <input
          type="date"
          className={rangeInputClass}
          value={start}
          onChange={(e) => setStart(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void commit()
            else if (e.key === 'Escape') close()
          }}
        />
        <span className="text-xs text-muted-text">→</span>
        <input
          type="date"
          className={rangeInputClass}
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void commit()
            else if (e.key === 'Escape') close()
          }}
        />
      </div>
    </CellEditorPanel>
  )
}

function SelectEditor({
  column,
  value,
  onCommit,
  onAddOption,
  close
}: ColumnEditorProps): ReactElement {
  const options = column.options ?? []
  const current = coerceText(value)
  const popoverRef = useRef<HTMLDivElement>(null)
  const dismissRefs = useMemo(() => [popoverRef], [])
  useDismissible({ isOpen: true, onClose: close, refs: dismissRefs })

  return (
    <div ref={popoverRef} className="glass-surface absolute z-10 min-w-[200px] p-2">
      <SelectOptionList
        options={options}
        current={current}
        onPick={(next) => {
          void onCommit(next).then((saved) => { if (saved) close() })
        }}
        onAddOption={onAddOption}
      />
    </div>
  )
}

function MultiSelectEditor({
  column,
  value,
  onCommit,
  onAddOption,
  close
}: ColumnEditorProps): ReactElement {
  const options = column.options ?? []
  const [draft, setDraft] = useState<string[]>(coerceList(value))
  const popoverRef = useRef<HTMLDivElement>(null)
  const dismissRefs = useMemo(() => [popoverRef], [])
  const commitAndClose = useCallback(async () => {
    if (await onCommit(draft)) close()
  }, [draft, onCommit, close])
  useDismissible({
    isOpen: true,
    onClose: commitAndClose,
    onEscape: close,
    refs: dismissRefs,
    escapeKey: true
  })

  return (
    <div ref={popoverRef} className="glass-surface absolute z-10 min-w-[200px] p-2">
      <MultiSelectOptionList
        options={options}
        draft={draft}
        setDraft={setDraft}
        onCommit={commitAndClose}
        onCancel={close}
        onAddOption={onAddOption}
      />
    </div>
  )
}

function ListEditor({ value, onCommit, close }: EditorProps): ReactElement {
  const [draft, setDraft] = useState(coerceList(value).join(', '))
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])

  const commit = async (): Promise<void> => {
    const next = draft
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    if (await onCommit(next)) close()
  }

  return (
    <CellEditorPanel onCommit={commit} onCancel={close}>
      <input
        ref={inputRef}
        type="text"
        className={INPUT_CLASS}
        placeholder="Comma-separated"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) void commit()
          else if (e.key === 'Escape') close()
        }}
      />
    </CellEditorPanel>
  )
}

function CellEditorPanel({
  children,
  onCommit,
  onCancel,
  minWidth = 240
}: {
  children: ReactElement
  onCommit: () => void
  onCancel: () => void
  minWidth?: number
}): ReactElement {
  const panelRef = useRef<HTMLDivElement>(null)
  const dismissRefs = useMemo(() => [panelRef], [])
  useDismissible({ isOpen: true, onClose: onCommit, onEscape: onCancel, refs: dismissRefs })

  return (
    <div
      ref={panelRef}
      className="glass-surface absolute left-0 top-0 z-20 max-w-[360px] p-2 shadow-lg"
      style={{ minWidth }}
    >
      {children}
      <EditorActionRow onCancel={onCancel} onCommit={onCommit} />
    </div>
  )
}
