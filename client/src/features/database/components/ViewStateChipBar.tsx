// ViewStateChipBar - Active sort/filter summary pills above the table.
//
// Renders nothing when no sort or filter is active, so the table area
// doesn't take up extra vertical space in the common "clean view" case.
// Each chip shows a compact human summary and an `×` button that removes
// that single rule. A trailing "Clear all" button wipes everything.

import type { ReactElement } from 'react'
import { ArrowDown, ArrowUp, Filter, X } from 'lucide-react'
import type {
  DatabaseColumnSchema,
  DatabaseFilterCondition,
  DatabaseSortRule,
  DatabaseViewState
} from '@shared/database'
import { operatorLabel } from '../utils/filterOperators'

interface ViewStateChipBarProps {
  columns: DatabaseColumnSchema[]
  viewState: DatabaseViewState
  onRemoveSort: (columnId: string) => void
  onRemoveFilter: (columnId: string) => void
  onClearAll: () => void
}

export function ViewStateChipBar({
  columns,
  viewState,
  onRemoveSort,
  onRemoveFilter,
  onClearAll
}: ViewStateChipBarProps): ReactElement | null {
  const hasSort = viewState.sort.length > 0
  const hasFilter = viewState.filter.conditions.length > 0
  if (!hasSort && !hasFilter) return null

  const byId = new Map<string, DatabaseColumnSchema>()
  for (const col of columns) byId.set(col.id, col)

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-6 pb-2">
      {viewState.sort.map((rule) => {
        const col = byId.get(rule.columnId)
        if (!col) return null
        return (
          <SortChip
            key={`sort-${rule.columnId}`}
            column={col}
            rule={rule}
            onRemove={() => onRemoveSort(rule.columnId)}
          />
        )
      })}
      {viewState.filter.conditions.map((cond) => {
        const col = byId.get(cond.columnId)
        if (!col) return null
        return (
          <FilterChip
            key={`filter-${cond.columnId}`}
            column={col}
            condition={cond}
            onRemove={() => onRemoveFilter(cond.columnId)}
          />
        )
      })}
      <button
        type="button"
        onClick={onClearAll}
        className="ml-1 rounded-md px-2 py-1 text-[10px] font-medium text-muted-text hover:bg-surface-overlay hover:text-neutral-ink transition-colors"
      >
        Clear all
      </button>
    </div>
  )
}

// ========================================
// Chips
// ========================================

export function SortChip({
  column,
  rule,
  onRemove
}: {
  column: DatabaseColumnSchema
  rule: DatabaseSortRule
  onRemove: () => void
}): ReactElement {
  const Arrow = rule.direction === 'desc' ? ArrowDown : ArrowUp
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--glass-border)] bg-surface-overlay/60 pl-2 pr-1 py-0.5 text-[11px] text-neutral-ink">
      <Arrow className="h-3 w-3 text-muted-text" />
      <span className="truncate max-w-[120px]">{column.name}</span>
      <button
        type="button"
        onClick={onRemove}
        className="flex h-4 w-4 items-center justify-center rounded-full text-muted-text hover:bg-red-500/20 hover:text-red-500"
        aria-label={`Remove sort on ${column.name}`}
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </span>
  )
}

export function FilterChip({
  column,
  condition,
  onRemove
}: {
  column: DatabaseColumnSchema
  condition: DatabaseFilterCondition
  onRemove: () => void
}): ReactElement {
  const valueText = formatConditionValue(condition)
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--glass-border)] bg-surface-overlay/60 pl-2 pr-1 py-0.5 text-[11px] text-neutral-ink">
      <Filter className="h-3 w-3 text-muted-text" />
      <span className="truncate max-w-[220px]">
        <span className="font-medium">{column.name}</span>
        <span className="text-muted-text">
          {' '}
          · {operatorLabel(condition.operator).toLowerCase()}
        </span>
        {valueText && <span className="text-muted-text"> · {valueText}</span>}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="flex h-4 w-4 items-center justify-center rounded-full text-muted-text hover:bg-red-500/20 hover:text-red-500"
        aria-label={`Remove filter on ${column.name}`}
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </span>
  )
}

/** Compact string summary of a condition's value payload. */
function formatConditionValue(cond: DatabaseFilterCondition): string {
  const v = cond.value
  if (v === null || v === undefined || v === '') return ''
  if (Array.isArray(v)) {
    const first = v[0]
    const second = v[1]
    const fmt = (x: unknown): string =>
      x === null || x === undefined || x === '' ? '?' : String(x)
    if (v.length === 2) return `${fmt(first)} – ${fmt(second)}`
    return v.map(fmt).join(', ')
  }
  if (typeof v === 'string') {
    return v.length > 24 ? `${v.slice(0, 24)}…` : v
  }
  return String(v)
}
