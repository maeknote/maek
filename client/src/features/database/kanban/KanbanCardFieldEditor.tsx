// KanbanCardFieldEditor — inline property editor mounted in a FloatingMenu
// portal anchored to the chip / value the user clicked on a Kanban card.
//
// Switches per column type. Simple input editors (text/number/date/date-range
// /list) are implemented inline since they are tiny; select/multi-select
// reuse the shared list components from cellEditors.tsx so behavior stays
// in lock-step with the table view.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject
} from 'react'
import { cn } from '@renderer/lib/utils'
import { FloatingMenu, type FloatingMenuPosition } from '@renderer/shared/components/FloatingMenu'
import type { DatabaseColumnSchema, DatabaseDateRangeValue } from '@shared/database'
import {
  coerceBoolean,
  coerceDateString,
  coerceList,
  coerceNumber,
  coerceText,
  parseDateRange
} from '../utils/cellFormat'
import { EditorActionRow, MultiSelectOptionList, SelectOptionList } from '../components/cellEditors'

interface KanbanCardFieldEditorProps {
  column: DatabaseColumnSchema
  value: unknown
  /** Anchor element to position the popover against. */
  anchorRef: RefObject<HTMLElement | null>
  onCommit: (next: unknown) => Promise<void>
  onClose: () => void
  /** Append a new option to the column's schema (select / multi-select only). */
  onAddOption?: (newOption: string) => Promise<void>
}

const INPUT_CLASS =
  'w-full rounded-md border border-[var(--color-input-border-focus)] bg-[var(--color-input-bg)] px-2 py-1.5 text-sm text-neutral-ink outline-none placeholder:text-muted-text'

export function KanbanCardFieldEditor({
  column,
  value,
  anchorRef,
  onCommit,
  onClose,
  onAddOption
}: KanbanCardFieldEditorProps): ReactElement | null {
  const [position, setPosition] = useState<FloatingMenuPosition | null>(null)
  const [commitError, setCommitError] = useState<string | null>(null)
  const outsideCommit = useRef<(() => void) | null>(null)
  const registerOutsideCommit = useCallback((callback: () => void) => {
    outsideCommit.current = callback
  }, [])
  const commit = async (next: unknown): Promise<void> => {
    setCommitError(null)
    try {
      await onCommit(next)
    } catch (cause) {
      setCommitError(cause instanceof Error ? cause.message : 'Could not save this property')
      throw cause
    }
  }

  // Anchor the popover under (or above, FloatingMenu handles the flip)
  // the trigger element. Recompute on mount; FloatingMenu itself handles
  // window resize.
  useEffect(() => {
    const el = anchorRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPosition({ x: rect.left, y: rect.bottom })
  }, [anchorRef])

  const minWidth = column.type === 'select' || column.type === 'multi-select' ? 220 : 240

  return (
    <FloatingMenu
      isOpen={position !== null}
      position={position}
      onClose={onClose}
      onOutsideClick={() => {
        if (outsideCommit.current) outsideCommit.current()
        else onClose()
      }}
      onEscape={onClose}
      anchorRef={anchorRef}
      minWidth={minWidth}
      className="p-2"
    >
      <>
        {commitError && <p role="alert" className="mb-2 max-w-64 text-xs text-red-500">{commitError}</p>}
        <EditorBody column={column} value={value} onCommit={commit} onClose={onClose} onAddOption={onAddOption} registerOutsideCommit={registerOutsideCommit} />
      </>
    </FloatingMenu>
  )
}

interface EditorBodyProps {
  column: DatabaseColumnSchema
  value: unknown
  onCommit: (next: unknown) => Promise<void>
  onClose: () => void
  onAddOption?: (newOption: string) => Promise<void>
  registerOutsideCommit: (callback: () => void) => void
}

function EditorBody({
  column,
  value,
  onCommit,
  onClose,
  onAddOption,
  registerOutsideCommit
}: EditorBodyProps): ReactElement {
  switch (column.type) {
    case 'select':
      return (
        <SelectBody
          column={column}
          value={value}
          onCommit={onCommit}
          onClose={onClose}
          onAddOption={onAddOption}
          registerOutsideCommit={registerOutsideCommit}
        />
      )
    case 'multi-select':
      return (
        <MultiSelectBody
          column={column}
          value={value}
          onCommit={onCommit}
          onClose={onClose}
          onAddOption={onAddOption}
          registerOutsideCommit={registerOutsideCommit}
        />
      )
    case 'number':
      return <NumberBody value={value} onCommit={onCommit} onClose={onClose} registerOutsideCommit={registerOutsideCommit} />
    case 'boolean':
      return <BooleanBody value={value} onCommit={onCommit} onClose={onClose} registerOutsideCommit={registerOutsideCommit} />
    case 'date':
      return <DateBody value={value} onCommit={onCommit} onClose={onClose} registerOutsideCommit={registerOutsideCommit} />
    case 'date-range':
      return <DateRangeBody value={value} onCommit={onCommit} onClose={onClose} registerOutsideCommit={registerOutsideCommit} />
    case 'list':
      return <ListBody value={value} onCommit={onCommit} onClose={onClose} registerOutsideCommit={registerOutsideCommit} />
    default:
      return <TextBody value={value} onCommit={onCommit} onClose={onClose} registerOutsideCommit={registerOutsideCommit} />
  }
}

interface SimpleBodyProps {
  value: unknown
  onCommit: (next: unknown) => Promise<void>
  onClose: () => void
  registerOutsideCommit: (callback: () => void) => void
}

interface ColumnBodyProps extends SimpleBodyProps {
  column: DatabaseColumnSchema
  onAddOption?: (newOption: string) => Promise<void>
}

// SelectBody — single-select; outside-click closes the popover via FloatingMenu's
// own dismissable. No commit-on-dismiss because a select picks via explicit click.
function SelectBody({
  column,
  value,
  onCommit,
  onClose,
  onAddOption,
  registerOutsideCommit
}: ColumnBodyProps): ReactElement {
  useEffect(() => registerOutsideCommit(onClose), [onClose, registerOutsideCommit])
  const options = column.options ?? []
  const current = coerceText(value)
  return (
    <SelectOptionList
      options={options}
      current={current}
      onPick={(next) => {
        void onCommit(next).then(onClose).catch(() => {})
      }}
      onAddOption={onAddOption}
    />
  )
}

function MultiSelectBody({
  column,
  value,
  onCommit,
  onClose,
  onAddOption,
  registerOutsideCommit
}: ColumnBodyProps): ReactElement {
  const options = column.options ?? []
  const [draft, setDraft] = useState<string[]>(coerceList(value))
  const commit = async (): Promise<void> => { await onCommit(draft); onClose() }
  useEffect(() => {
    registerOutsideCommit(() => { void commit().catch(() => {}) })
  }, [commit, registerOutsideCommit])

  return (
    <MultiSelectOptionList
      options={options}
      draft={draft}
      setDraft={setDraft}
      onCommit={commit}
      onCancel={() => {
        onClose()
      }}
      onAddOption={onAddOption}
    />
  )
}

function TextBody({ value, onCommit, onClose, registerOutsideCommit }: SimpleBodyProps): ReactElement {
  const [draft, setDraft] = useState(coerceText(value))
  const ref = useRef<HTMLTextAreaElement>(null)
  const resize = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])
  const commit = async (): Promise<void> => { await onCommit(draft); onClose() }
  useEffect(() => { registerOutsideCommit(() => { void commit().catch(() => {}) }) }, [commit, registerOutsideCommit])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    resize()
  }, [resize])

  return (
    <BodyWrapper>
      <textarea
        ref={ref}
        rows={1}
        className={cn(
          INPUT_CLASS,
          'min-h-[36px] resize-none whitespace-pre-wrap break-words leading-5'
        )}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          resize()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void commit().catch(() => {})
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      />
      <EditorActionRow
        onCancel={onClose}
        onCommit={commit}
      />
    </BodyWrapper>
  )
}

function NumberBody({ value, onCommit, onClose, registerOutsideCommit }: SimpleBodyProps): ReactElement {
  const initial = coerceNumber(value)
  const [draft, setDraft] = useState(initial === null ? '' : String(initial))
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])

  const commit = async (): Promise<void> => {
    if (draft.trim() === '') {
      await onCommit(null)
    } else {
      const n = Number(draft)
      await onCommit(Number.isFinite(n) ? n : null)
    }
    onClose()
  }
  useEffect(() => { registerOutsideCommit(() => { void commit().catch(() => {}) }) }, [commit, registerOutsideCommit])

  return (
    <BodyWrapper>
      <input
        ref={ref}
        type="number"
        className={INPUT_CLASS}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) void commit().catch(() => {})
          else if (e.key === 'Escape') onClose()
        }}
      />
      <EditorActionRow onCancel={onClose} onCommit={commit} />
    </BodyWrapper>
  )
}

function BooleanBody({ value, onCommit, onClose, registerOutsideCommit }: SimpleBodyProps): ReactElement {
  const current = coerceBoolean(value)
  useEffect(() => { registerOutsideCommit(onClose) }, [onClose, registerOutsideCommit])

  const pick = async (next: boolean | null): Promise<void> => {
    await onCommit(next)
    onClose()
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => { void pick(true).catch(() => {}) }}
        className={cn(
          'w-full rounded-md px-2 py-1 text-left text-sm hover:bg-surface-overlay',
          current ? 'bg-surface-overlay/70 text-maek-red' : 'text-neutral-ink'
        )}
      >
        Checked
      </button>
      <button
        type="button"
        onClick={() => { void pick(false).catch(() => {}) }}
        className={cn(
          'w-full rounded-md px-2 py-1 text-left text-sm hover:bg-surface-overlay',
          !current && value !== null && value !== undefined
            ? 'bg-surface-overlay/70 text-maek-red'
            : 'text-neutral-ink'
        )}
      >
        Unchecked
      </button>
      <button
        type="button"
        onClick={() => { void pick(null).catch(() => {}) }}
        className="w-full rounded-md px-2 py-1 text-left text-sm text-muted-text hover:bg-surface-overlay"
      >
        Clear
      </button>
    </div>
  )
}

function DateBody({ value, onCommit, onClose, registerOutsideCommit }: SimpleBodyProps): ReactElement {
  const [draft, setDraft] = useState(coerceDateString(value))
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])

  const commit = async (): Promise<void> => {
    await onCommit(draft || '')
    onClose()
  }
  useEffect(() => { registerOutsideCommit(() => { void commit().catch(() => {}) }) }, [commit, registerOutsideCommit])

  return (
    <BodyWrapper>
      <input
        ref={ref}
        type="date"
        className={INPUT_CLASS}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) void commit().catch(() => {})
          else if (e.key === 'Escape') onClose()
        }}
      />
      <EditorActionRow onCancel={onClose} onCommit={commit} />
    </BodyWrapper>
  )
}

function DateRangeBody({ value, onCommit, onClose, registerOutsideCommit }: SimpleBodyProps): ReactElement {
  const initial = parseDateRange(value)
  const [start, setStart] = useState(initial.start ?? '')
  const [end, setEnd] = useState(initial.end ?? '')

  const commit = async (): Promise<void> => {
    const next: DatabaseDateRangeValue = {
      start: start.trim() === '' ? null : start,
      end: end.trim() === '' ? null : end
    }
    await onCommit(next)
    onClose()
  }
  useEffect(() => { registerOutsideCommit(() => { void commit().catch(() => {}) }) }, [commit, registerOutsideCommit])

  const rangeInputClass =
    'flex-1 rounded-md border border-[var(--color-input-border-focus)] bg-[var(--color-input-bg)] px-2 py-1 text-xs text-neutral-ink outline-none'

  return (
    <BodyWrapper>
      <div className="flex items-center gap-1">
        <input
          type="date"
          className={rangeInputClass}
          value={start}
          onChange={(e) => setStart(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void commit().catch(() => {})
            else if (e.key === 'Escape') onClose()
          }}
        />
        <span className="text-xs text-muted-text">→</span>
        <input
          type="date"
          className={rangeInputClass}
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void commit().catch(() => {})
            else if (e.key === 'Escape') onClose()
          }}
        />
      </div>
      <EditorActionRow onCancel={onClose} onCommit={commit} />
    </BodyWrapper>
  )
}

function ListBody({ value, onCommit, onClose, registerOutsideCommit }: SimpleBodyProps): ReactElement {
  const [draft, setDraft] = useState(coerceList(value).join(', '))
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])

  const commit = async (): Promise<void> => {
    const next = draft
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    await onCommit(next)
    onClose()
  }
  useEffect(() => { registerOutsideCommit(() => { void commit().catch(() => {}) }) }, [commit, registerOutsideCommit])

  return (
    <BodyWrapper>
      <input
        ref={ref}
        type="text"
        className={INPUT_CLASS}
        placeholder="Comma-separated"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) void commit().catch(() => {})
          else if (e.key === 'Escape') onClose()
        }}
      />
      <EditorActionRow onCancel={onClose} onCommit={commit} />
    </BodyWrapper>
  )
}

function BodyWrapper({ children }: { children: ReactNode }): ReactElement {
  return <div className="min-w-0">{children}</div>
}
