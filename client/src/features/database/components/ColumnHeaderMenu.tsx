// ColumnHeaderMenu - Dropdown menu for editing a single column.
//
// Sections (in order):
//   1. Name input (always)
//   2. Insert column left/right
//   3. Type selector (closes the menu after selection)
//   4. Format trigger → opens a Format submenu to the right (number columns only)
//   5. Options trigger → opens an Options submenu to the right (select / multi-select only)
//   6. Delete column
//
// Sort and filter live in the view-level `ViewFilterSortToolbar` so every
// database view (table / kanban / calendar / timeline) shares one entry
// point. Format / Options live in side submenus (separate FloatingMenu
// instances) so the parent menu stays compact.

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { ArrowLeftToLine, ArrowRightToLine, List, Plus, Trash2 } from 'lucide-react'
import {
  FloatingMenu,
  MenuItem,
  MenuSeparator,
  type FloatingMenuPosition
} from '@renderer/shared/components'
import type { DatabaseColumnSchema, DatabaseColumnType, NumberFormat } from '@shared/database'
import { SelectOptionsReorderList } from './SelectOptionsReorderList'

interface ColumnHeaderMenuProps {
  isOpen: boolean
  position: FloatingMenuPosition | null
  column: DatabaseColumnSchema
  onClose: () => void
  onChangeName: (newName: string) => void | Promise<void>
  onChangeType: (newType: DatabaseColumnType) => void | Promise<void>
  onChangeNumberFormat: (format: NumberFormat) => void | Promise<void>
  onChangeOptions: (options: string[]) => void | Promise<void>
  onInsertLeft: () => void | Promise<void>
  onInsertRight: () => void | Promise<void>
  onDelete: () => void | Promise<void>
}

const COLUMN_TYPE_LABELS: Array<{ type: DatabaseColumnType; label: string; badge: string }> = [
  { type: 'text', label: 'Text', badge: 'Aa' },
  { type: 'number', label: 'Number', badge: '#' },
  { type: 'boolean', label: 'Checkbox', badge: '☑' },
  { type: 'date', label: 'Date', badge: '📅' },
  { type: 'date-range', label: 'Date range', badge: '↔' },
  { type: 'select', label: 'Select', badge: '⌄' },
  { type: 'multi-select', label: 'Multi-select', badge: '⌄⌄' },
  { type: 'list', label: 'List', badge: '≡' }
]

const NUMBER_FORMAT_LABELS: Array<{ format: NumberFormat; label: string; sample: string }> = [
  { format: 'plain', label: 'Plain', sample: '1234.5' },
  { format: 'integer', label: 'Integer', sample: '1,234' },
  { format: 'decimal', label: 'Decimal', sample: '1,234.50' },
  { format: 'percent', label: 'Percent', sample: '12.34%' },
  { format: 'currency-usd', label: 'USD', sample: '$1,234.50' },
  { format: 'currency-krw', label: 'KRW', sample: '₩1,234' }
]

type SubmenuKind = 'format' | 'options' | null

export function ColumnHeaderMenu({
  isOpen,
  position,
  column,
  onClose,
  onChangeName,
  onChangeType,
  onChangeNumberFormat,
  onChangeOptions,
  onInsertLeft,
  onInsertRight,
  onDelete
}: ColumnHeaderMenuProps): ReactElement {
  // Initial draft comes from the column prop. The parent remounts this component
  // per column (via React `key`), so we never need to sync draft ↔ prop via effect.
  const [nameDraft, setNameDraft] = useState(column.name)
  const inputRef = useRef<HTMLInputElement>(null)
  // Track the last committed name so repeated commit attempts (e.g. blur + close)
  // don't fire onChangeName twice with the same value.
  const committedNameRef = useRef(column.name)

  // Submenu state
  const [submenuKind, setSubmenuKind] = useState<SubmenuKind>(null)
  const [submenuPosition, setSubmenuPosition] = useState<FloatingMenuPosition | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const formatTriggerRef = useRef<HTMLButtonElement>(null)
  const optionsTriggerRef = useRef<HTMLButtonElement>(null)
  // Refs to the submenu inner wrappers — passed as `extraDismissRefs` to the
  // parent FloatingMenu so that clicks inside the submenu (which lives in a
  // separate portal) don't dismiss the parent menu.
  const formatSubmenuInnerRef = useRef<HTMLDivElement>(null)
  const optionsSubmenuInnerRef = useRef<HTMLDivElement>(null)
  const extraDismissRefs = useMemo(() => [formatSubmenuInnerRef, optionsSubmenuInnerRef], [])

  // Focus the name input after the FloatingMenu finishes mounting.
  useEffect(() => {
    const handle = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => cancelAnimationFrame(handle)
  }, [])

  // Always cancel any pending submenu close timer when this component unmounts.
  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current)
      }
    }
  }, [])

  const cancelClose = (): void => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }

  const scheduleCloseSubmenu = (): void => {
    cancelClose()
    closeTimerRef.current = window.setTimeout(() => {
      setSubmenuKind(null)
      closeTimerRef.current = null
    }, 200)
  }

  const openSubmenu = (kind: 'format' | 'options', triggerEl: HTMLElement | null): void => {
    cancelClose()
    if (!triggerEl) return
    const rect = triggerEl.getBoundingClientRect()
    setSubmenuPosition({ x: rect.right + 4, y: rect.top })
    setSubmenuKind(kind)
  }

  const commitName = (): void => {
    const trimmed = nameDraft.trim()
    if (trimmed === '' || trimmed === committedNameRef.current) {
      setNameDraft(committedNameRef.current)
      return
    }
    committedNameRef.current = trimmed
    void onChangeName(trimmed)
  }

  // Commit any pending name edit before the menu actually closes. Outside-click
  // dismissal via useDismissible fires on `mousedown`, which unmounts the input
  // before its native `blur` can run — without this wrapper the draft would be
  // silently dropped.
  const handleClose = (): void => {
    commitName()
    onClose()
  }

  const isNumber = column.type === 'number'
  const hasOptions = column.type === 'select' || column.type === 'multi-select'
  const currentFormat = column.numberFormat ?? 'plain'
  const currentFormatSample = NUMBER_FORMAT_LABELS.find((f) => f.format === currentFormat)?.sample

  return (
    <>
      <FloatingMenu
        isOpen={isOpen}
        position={position}
        onClose={handleClose}
        minWidth={240}
        extraDismissRefs={extraDismissRefs}
      >
        {/* Name input */}
        <div className="px-2 pt-2 pb-1">
          <input
            ref={inputRef}
            type="text"
            value={nameDraft}
            spellCheck={false}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              // Skip Enter while an IME composition is in progress so the
              // last character (e.g. Korean syllable) isn't dropped.
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                commitName()
                onClose()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setNameDraft(column.name)
                onClose()
              }
            }}
            className="w-full rounded-md border border-[var(--color-input-border)] bg-[var(--color-input-bg)] px-2 py-1.5 text-sm text-neutral-ink placeholder:text-muted-text focus:border-[var(--color-input-border-focus)] focus:outline-none"
            placeholder="Column name"
          />
        </div>

        <MenuSeparator />

        {/* Insert section */}
        <div onMouseEnter={scheduleCloseSubmenu}>
          <MenuItem
            icon={<ArrowLeftToLine className="w-4 h-4" />}
            label="Insert column left"
            onClick={() => {
              void onInsertLeft()
              onClose()
            }}
          />
          <MenuItem
            icon={<ArrowRightToLine className="w-4 h-4" />}
            label="Insert column right"
            onClick={() => {
              void onInsertRight()
              onClose()
            }}
          />
        </div>

        <MenuSeparator />

        {/* Column-type-specific configuration triggers (Format / Options).
            Both live above the Type list so all "what kind of values does this
            column hold" controls are grouped together. */}
        {isNumber && (
          <MenuItem
            ref={formatTriggerRef}
            icon={
              <span className="inline-flex min-w-4 items-center justify-center text-[10px] font-mono text-muted-text">
                #
              </span>
            }
            label="Format"
            // Sample text lives in the shortcut slot so the label sits on the
            // left and the example sits on the right edge.
            shortcut={currentFormatSample ?? '▶'}
            onMouseEnter={() => openSubmenu('format', formatTriggerRef.current)}
            onMouseLeave={scheduleCloseSubmenu}
            onClick={() => openSubmenu('format', formatTriggerRef.current)}
          />
        )}
        {hasOptions && (
          <MenuItem
            ref={optionsTriggerRef}
            icon={<List className="w-4 h-4" />}
            label="Options"
            shortcut="▶"
            onMouseEnter={() => openSubmenu('options', optionsTriggerRef.current)}
            onMouseLeave={scheduleCloseSubmenu}
            onClick={() => openSubmenu('options', optionsTriggerRef.current)}
          />
        )}
        {(isNumber || hasOptions) && <MenuSeparator />}

        {/* Type section — selecting any type closes the menu */}
        <div
          className="px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-text"
          onMouseEnter={scheduleCloseSubmenu}
        >
          Type
        </div>
        <div onMouseEnter={scheduleCloseSubmenu}>
          {COLUMN_TYPE_LABELS.map((entry) => {
            const isSelected = column.type === entry.type
            return (
              <MenuItem
                key={entry.type}
                icon={
                  <span className="inline-flex h-4 min-w-4 items-center justify-center rounded bg-surface-overlay px-1 text-[10px] font-semibold text-muted-text">
                    {entry.badge}
                  </span>
                }
                label={entry.label}
                selected={isSelected}
                shortcut={isSelected ? '✓' : undefined}
                onClick={() => {
                  if (!isSelected) void onChangeType(entry.type)
                  onClose()
                }}
              />
            )
          })}
        </div>

        <MenuSeparator />

        <div onMouseEnter={scheduleCloseSubmenu}>
          <MenuItem
            icon={<Trash2 className="w-4 h-4" />}
            label="Delete column"
            destructive
            onClick={() => {
              void onDelete()
              onClose()
            }}
          />
        </div>
      </FloatingMenu>

      {/* Format submenu — selecting a format does NOT close any menu so the
          user can preview multiple formats in a row. The submenu (and parent)
          stay open until the user clicks outside or moves the mouse away. */}
      {submenuKind === 'format' && (
        <FloatingMenu
          isOpen
          position={submenuPosition}
          onClose={() => setSubmenuKind(null)}
          minWidth={260}
        >
          <div
            ref={formatSubmenuInnerRef}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleCloseSubmenu}
          >
            {NUMBER_FORMAT_LABELS.map((entry) => {
              const isSelected = currentFormat === entry.format
              return (
                <MenuItem
                  key={entry.format}
                  label={entry.label}
                  selected={isSelected}
                  // Sample text lives in the shortcut slot so the label sits on
                  // the left and the example sits on the right edge.
                  shortcut={entry.sample}
                  onClick={() => {
                    if (!isSelected) void onChangeNumberFormat(entry.format)
                  }}
                />
              )
            })}
          </div>
        </FloatingMenu>
      )}

      {/* Options submenu — clicks inside (input, add button, chip removal)
          do NOT close any menu so the user can edit options freely. */}
      {submenuKind === 'options' && (
        <FloatingMenu
          isOpen
          position={submenuPosition}
          onClose={() => setSubmenuKind(null)}
          minWidth={300}
        >
          <div
            ref={optionsSubmenuInnerRef}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleCloseSubmenu}
          >
            <OptionsEditor
              columnId={column.id}
              options={column.options ?? []}
              onChange={(next) => void onChangeOptions(next)}
            />
          </div>
        </FloatingMenu>
      )}
    </>
  )
}

// ========================================
// OptionsEditor — chip list for select / multi-select options
// ========================================

interface OptionsEditorProps {
  columnId: string
  options: string[]
  onChange: (next: string[]) => void
}

function OptionsEditor({ columnId, options, onChange }: OptionsEditorProps): ReactElement {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus the input when the submenu opens (component mounts).
  useEffect(() => {
    const handle = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(handle)
  }, [])

  const addOption = (): void => {
    const trimmed = draft.trim()
    if (trimmed === '' || options.includes(trimmed)) {
      setDraft('')
      return
    }
    onChange([...options, trimmed])
    setDraft('')
  }

  const removeOption = (target: string): void => {
    onChange(options.filter((o) => o !== target))
  }

  return (
    <div className="px-2 pt-2 pb-2">
      <div className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-text">
        Options
      </div>

      {/* Add input — sits at the top so newly added chips appear below it. */}
      <div className="mb-2 flex items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Skip Enter while an IME composition is in progress so the
            // final composed character isn't dropped.
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              addOption()
            }
          }}
          placeholder="Add option…"
          spellCheck={false}
          className="flex-1 min-w-0 rounded-md border border-[var(--color-input-border)] bg-[var(--color-input-bg)] px-2 py-1.5 text-xs text-neutral-ink placeholder:text-muted-text focus:border-[var(--color-input-border-focus)] focus:outline-none"
        />
        <button
          type="button"
          onClick={addOption}
          disabled={draft.trim() === ''}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-text hover:bg-surface-overlay hover:text-neutral-ink disabled:opacity-30"
          aria-label="Add option"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <SelectOptionsReorderList
        options={options}
        onReorder={onChange}
        onRemove={removeOption}
        droppableId={`options-${columnId}`}
      />
    </div>
  )
}
