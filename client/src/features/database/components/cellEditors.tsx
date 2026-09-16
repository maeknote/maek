// cellEditors — popover content blocks shared by Cell.tsx (table view) and
// KanbanCardFieldEditor (kanban inline edit).
//
// These components render only the inner content (option lists, add-option
// input). The host is responsible for positioning + outside-click handling.

import { useRef, useState, type ReactElement } from 'react'
import { Plus } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

interface AddOptionRowProps {
  onAdd: (newOption: string) => void
  existing: string[]
}

export function AddOptionRow({ onAdd, existing }: AddOptionRowProps): ReactElement {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = (): void => {
    const trimmed = draft.trim()
    if (trimmed === '' || existing.includes(trimmed)) {
      setDraft('')
      return
    }
    onAdd(trimmed)
    setDraft('')
  }

  return (
    <div className="mt-1 flex items-center gap-1 border-t border-[var(--glass-border)] pt-2">
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setDraft('')
          }
        }}
        placeholder="Add option…"
        spellCheck={false}
        className="flex-1 min-w-0 rounded-md border border-[var(--color-input-border)] bg-[var(--color-input-bg)] px-2 py-1 text-xs text-neutral-ink placeholder:text-muted-text focus:border-[var(--color-input-border-focus)] focus:outline-none"
      />
      <button
        type="button"
        onClick={submit}
        disabled={draft.trim() === ''}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-text hover:bg-surface-overlay hover:text-neutral-ink disabled:opacity-30"
        aria-label="Add option"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

interface SelectOptionListProps {
  options: string[]
  /** Currently selected value (empty string == cleared). */
  current: string
  /** Called with the picked option, or '' to clear. */
  onPick: (value: string) => void
  /** Append a brand-new option to the column schema. */
  onAddOption?: (newOption: string) => void
}

export function SelectOptionList({
  options,
  current,
  onPick,
  onAddOption
}: SelectOptionListProps): ReactElement {
  return (
    <>
      <button
        type="button"
        onClick={() => onPick('')}
        className="w-full rounded-md px-2 py-1 text-left text-sm text-muted-text hover:bg-surface-overlay"
      >
        — Clear
      </button>

      {options.length === 0 && (
        <div className="px-2 py-1 text-xs text-muted-text">No options yet</div>
      )}
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onPick(opt)}
          className={cn(
            'w-full truncate rounded-md px-2 py-1 text-left text-sm hover:bg-surface-overlay',
            current === opt ? 'bg-surface-overlay/70 text-maek-red' : 'text-neutral-ink'
          )}
        >
          {opt}
        </button>
      ))}

      {onAddOption && (
        <AddOptionRow
          existing={options}
          onAdd={(newOption) => {
            onAddOption(newOption)
            onPick(newOption)
          }}
        />
      )}
    </>
  )
}

interface MultiSelectOptionListProps {
  options: string[]
  draft: string[]
  setDraft: (next: string[]) => void
  onCommit: () => void
  onCancel: () => void
  onAddOption?: (newOption: string) => void
}

interface EditorActionRowProps {
  onCancel: () => void
  onCommit: () => void
}

export function EditorActionRow({ onCancel, onCommit }: EditorActionRowProps): ReactElement {
  return (
    <div className="mt-2 flex justify-end gap-1 border-t border-[var(--glass-border)] pt-2">
      <button
        type="button"
        className="rounded-md px-2 py-1 text-xs text-muted-text hover:bg-surface-overlay hover:text-neutral-ink"
        onClick={onCancel}
      >
        Cancel
      </button>
      <button
        type="button"
        className="rounded-md bg-maek-red/10 px-2 py-1 text-xs font-medium text-maek-red hover:bg-maek-red/20"
        onClick={onCommit}
      >
        Done
      </button>
    </div>
  )
}

export function MultiSelectOptionList({
  options,
  draft,
  setDraft,
  onCommit,
  onCancel,
  onAddOption
}: MultiSelectOptionListProps): ReactElement {
  const toggle = (opt: string): void => {
    setDraft(draft.includes(opt) ? draft.filter((p) => p !== opt) : [...draft, opt])
  }

  return (
    <>
      {options.length === 0 && (
        <div className="px-2 py-1 text-xs text-muted-text">No options yet</div>
      )}
      {options.map((opt) => (
        <label
          key={opt}
          className="flex max-w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm text-neutral-ink hover:bg-surface-overlay"
        >
          <input
            type="checkbox"
            checked={draft.includes(opt)}
            onChange={() => toggle(opt)}
            className="shrink-0"
          />
          <span className="truncate">{opt}</span>
        </label>
      ))}

      {onAddOption && (
        <AddOptionRow
          existing={options}
          onAdd={(newOption) => {
            onAddOption(newOption)
            // Auto-include the brand new option in the current selection.
            if (!draft.includes(newOption)) setDraft([...draft, newOption])
          }}
        />
      )}

      <EditorActionRow onCancel={onCancel} onCommit={onCommit} />
    </>
  )
}
