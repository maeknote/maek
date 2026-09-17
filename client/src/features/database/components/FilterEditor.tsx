// FilterEditor - Operator + value editor for a single column's filter.
//
// Layout:
//   · Header strip with the column name and a "Remove" button (only when a
//     condition already exists — adding a brand-new filter hides it).
//   · Operator <select>, showing only operators allowed for the column type
//     (from `OPERATORS_BY_TYPE`).
//   · A value input that changes shape based on the operator's
//     `operatorValueKind`: text box, number box, number pair, date, date
//     pair, integer (days), or single-select. Operators with no value
//     input ("is empty", "bool checked", ...) skip this row.
//
// The editor keeps its own draft state and commits via `onChange` on every
// keystroke so the parent (`ColumnHeaderMenu`) can push the live condition
// into `DatabaseViewState` without a separate "Apply" click. "Done" /
// dismissing the submenu is what closes the popover — there is no cancel
// semantic because everything is already persisted incrementally.

import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Check, Trash2 } from 'lucide-react'
import type {
  DatabaseColumnSchema,
  DatabaseFilterCondition,
  DatabaseFilterOperator
} from '@shared/database'
import {
  OPERATORS_BY_TYPE,
  defaultOperatorForType,
  operatorLabel,
  operatorValueKind
} from '../utils/filterOperators'

interface FilterEditorProps {
  column: DatabaseColumnSchema
  /** Existing condition on this column, or null when adding a new one. */
  condition: DatabaseFilterCondition | null
  /** Commit a new/updated condition. */
  onChange: (next: DatabaseFilterCondition) => void
  /** Remove the condition entirely. Only shown when an existing condition is present. */
  onRemove?: () => void
  /**
   * Signal that the user is done editing — renders a check button in the
   * header. The condition is already applied live via `onChange`, so this
   * is purely an "I'm done, close the popover" action for callers that
   * manage the popover's visibility themselves.
   */
  onDone?: () => void
}

const INPUT_CLASS =
  'w-full rounded-md border border-[var(--color-input-border)] bg-[var(--color-input-bg)] px-2 py-1.5 text-xs text-neutral-ink placeholder:text-muted-text focus:border-[var(--color-input-border-focus)] focus:outline-none'

export function FilterEditor({
  column,
  condition,
  onChange,
  onRemove,
  onDone
}: FilterEditorProps): ReactElement {
  // Seed draft state from the existing condition, or default to the first
  // operator allowed for this column type.
  const initialOperator: DatabaseFilterOperator =
    condition?.operator ?? defaultOperatorForType(column.type)

  const [operator, setOperator] = useState<DatabaseFilterOperator>(initialOperator)
  const [value, setValue] = useState<unknown>(condition?.value ?? defaultValueForOperator(operator))

  // Focus the first input when the submenu opens so users can start typing
  // a value immediately (matches the Name input in ColumnHeaderMenu).
  const firstInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const handle = requestAnimationFrame(() => firstInputRef.current?.focus())
    return () => cancelAnimationFrame(handle)
  }, [])

  const commit = (nextOp: DatabaseFilterOperator, nextValue: unknown): void => {
    onChange({
      columnId: column.id,
      operator: nextOp,
      value: operatorValueKind(nextOp) === 'none' ? undefined : nextValue
    })
  }

  const handleOperatorChange = (nextOp: DatabaseFilterOperator): void => {
    // Reset the value payload when the operator's input shape changes so
    // we never leak e.g. a date string into a number operator.
    const prevKind = operatorValueKind(operator)
    const nextKind = operatorValueKind(nextOp)
    let nextValue = value
    if (prevKind !== nextKind) {
      nextValue = defaultValueForOperator(nextOp)
    }
    setOperator(nextOp)
    setValue(nextValue)
    commit(nextOp, nextValue)
  }

  const handleValueChange = (nextValue: unknown): void => {
    setValue(nextValue)
    commit(operator, nextValue)
  }

  const allowedOperators = OPERATORS_BY_TYPE[column.type]
  const kind = operatorValueKind(operator)

  return (
    <div className="flex w-[260px] flex-col gap-2 p-3">
      {/* Header: column name on the left, done (✓) and remove (🗑) on the right. */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wider text-muted-text">
          {column.name}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {onDone && (
            <button
              type="button"
              onClick={onDone}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-text hover:bg-maek-red/15 hover:text-maek-red"
              aria-label="Apply filter and close"
            >
              <Check className="h-3 w-3" />
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-text hover:bg-red-500/15 hover:text-red-500"
              aria-label="Remove filter"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Operator select */}
      <select
        value={operator}
        onChange={(e) => handleOperatorChange(e.target.value as DatabaseFilterOperator)}
        className={INPUT_CLASS}
        aria-label="Operator"
      >
        {allowedOperators.map((op) => (
          <option key={op} value={op}>
            {operatorLabel(op)}
          </option>
        ))}
      </select>

      {/* Value input — shape depends on the operator */}
      {kind !== 'none' && (
        <ValueInput
          kind={kind}
          value={value}
          column={column}
          firstInputRef={firstInputRef}
          onChange={handleValueChange}
        />
      )}
    </div>
  )
}

// ========================================
// ValueInput — variant per ValueInputKind
// ========================================

interface ValueInputProps {
  kind: ReturnType<typeof operatorValueKind>
  value: unknown
  column: DatabaseColumnSchema
  firstInputRef: React.RefObject<HTMLInputElement | null>
  onChange: (next: unknown) => void
}

function ValueInput({
  kind,
  value,
  column,
  firstInputRef,
  onChange
}: ValueInputProps): ReactElement | null {
  switch (kind) {
    case 'text':
      return (
        <input
          ref={firstInputRef}
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Value"
          spellCheck={false}
          className={INPUT_CLASS}
        />
      )
    case 'number':
      return (
        <input
          ref={firstInputRef}
          type="number"
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          placeholder="Number"
          className={INPUT_CLASS}
        />
      )
    case 'number-pair': {
      const pair = Array.isArray(value) ? value : [null, null]
      return (
        <div className="flex items-center gap-1.5">
          <input
            ref={firstInputRef}
            type="number"
            value={pair[0] === null || pair[0] === undefined ? '' : String(pair[0])}
            onChange={(e) =>
              onChange([e.target.value === '' ? null : Number(e.target.value), pair[1] ?? null])
            }
            placeholder="Min"
            className={INPUT_CLASS}
          />
          <span className="text-xs text-muted-text">—</span>
          <input
            type="number"
            value={pair[1] === null || pair[1] === undefined ? '' : String(pair[1])}
            onChange={(e) =>
              onChange([pair[0] ?? null, e.target.value === '' ? null : Number(e.target.value)])
            }
            placeholder="Max"
            className={INPUT_CLASS}
          />
        </div>
      )
    }
    case 'number-n':
      return (
        <input
          ref={firstInputRef}
          type="number"
          min={0}
          step={1}
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          placeholder="Days"
          className={INPUT_CLASS}
        />
      )
    case 'date':
      return (
        <input
          ref={firstInputRef}
          type="date"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className={INPUT_CLASS}
        />
      )
    case 'date-pair': {
      const pair = Array.isArray(value) ? value : ['', '']
      return (
        <div className="flex items-center gap-1.5">
          <input
            ref={firstInputRef}
            type="date"
            value={typeof pair[0] === 'string' ? pair[0] : ''}
            onChange={(e) => onChange([e.target.value, pair[1] ?? ''])}
            className={INPUT_CLASS}
          />
          <span className="text-xs text-muted-text">—</span>
          <input
            type="date"
            value={typeof pair[1] === 'string' ? pair[1] : ''}
            onChange={(e) => onChange([pair[0] ?? '', e.target.value])}
            className={INPUT_CLASS}
          />
        </div>
      )
    }
    case 'select-one': {
      const options = column.options ?? []
      const current = typeof value === 'string' ? value : ''
      return (
        <select value={current} onChange={(e) => onChange(e.target.value)} className={INPUT_CLASS}>
          <option value="">— Choose —</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      )
    }
    case 'none':
    default:
      return null
  }
}

/** Sensible starting payload for an operator's value. */
function defaultValueForOperator(op: DatabaseFilterOperator): unknown {
  const kind = operatorValueKind(op)
  switch (kind) {
    case 'text':
      return ''
    case 'number':
    case 'number-n':
      return null
    case 'number-pair':
      return [null, null]
    case 'date':
      return ''
    case 'date-pair':
      return ['', '']
    case 'select-one':
      return ''
    case 'none':
    default:
      return undefined
  }
}
