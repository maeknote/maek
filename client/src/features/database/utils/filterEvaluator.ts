// filterEvaluator - Apply filter conditions to rows.
//
// Pipeline contract (owned by DatabaseTableView):
//     raw rows  ->  applyFilter  ->  applySort  ->  render & aggregate
//
// All value coercion goes through `cellFormat.ts` so that filter matching
// agrees with the display semantics (an empty string, `null`, and missing
// key are all treated identically, etc.). The flat operator union is
// validated upstream via `isOperatorAllowed` — when a column type changes
// the table view drops incompatible conditions, so this evaluator can
// treat an operator/column mismatch as "row does not match".

import type {
  DatabaseColumnSchema,
  DatabaseFilterCondition,
  DatabaseFilterState,
  DatabaseRow
} from '@shared/database'
import {
  addDaysISO,
  coerceBoolean,
  coerceDateString,
  coerceList,
  coerceNumber,
  coerceText,
  isEmpty,
  parseDateRange,
  todayISO
} from './cellFormat'

/** Normalize text for case-insensitive matching. Locale-aware lowercase. */
function normText(value: string): string {
  return value.toLocaleLowerCase()
}

/** Parse `value` as a finite number; returns null on failure. */
function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = Number(value.trim())
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Parse `value` as an ISO date string (YYYY-MM-DD); returns '' on failure. */
function asDate(value: unknown): string {
  return coerceDateString(value)
}

/**
 * Split a "text" filter value (used by list operators) into a set of tokens.
 * The user types a comma-separated list; whitespace around each token is
 * trimmed and empty tokens are dropped.
 */
function splitListTokens(value: unknown): string[] {
  const raw = typeof value === 'string' ? value : ''
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

/**
 * For a date-range column, extract the "anchor" date used for single-date
 * operators (before / after / on). We use the range's start if present,
 * falling back to the end. When both are missing the row is considered
 * empty and is handled by the emptiness short-circuit above.
 */
function dateRangeAnchor(value: unknown): string {
  const range = parseDateRange(value)
  return range.start ?? range.end ?? ''
}

/**
 * Evaluate a single filter condition against a row. Returns `false` if the
 * column can't be found, the operator isn't applicable to the column type,
 * or the row value simply doesn't match the condition.
 */
export function evaluateCondition(
  row: DatabaseRow,
  column: DatabaseColumnSchema,
  condition: DatabaseFilterCondition
): boolean {
  const raw = row.yamlData[column.name]
  const empty = isEmpty(raw, column.type)

  // Common emptiness operators short-circuit first and do not care about type.
  if (condition.operator === 'is-empty') return empty
  if (condition.operator === 'is-not-empty') return !empty

  // For every other operator, an empty row never matches — this keeps
  // "not-contains" / "≠" from matching empty rows unexpectedly.
  if (empty) return false

  switch (condition.operator) {
    // --- Text operators ---
    case 'text-equals': {
      const a = normText(coerceText(raw))
      const b = normText(coerceText(condition.value))
      return a === b
    }
    case 'text-not-equals': {
      const a = normText(coerceText(raw))
      const b = normText(coerceText(condition.value))
      return a !== b
    }
    case 'text-contains': {
      const a = normText(coerceText(raw))
      const b = normText(coerceText(condition.value))
      if (b === '') return true // empty needle matches anything non-empty
      return a.includes(b)
    }
    case 'text-not-contains': {
      const a = normText(coerceText(raw))
      const b = normText(coerceText(condition.value))
      if (b === '') return true
      return !a.includes(b)
    }
    case 'text-starts-with': {
      const a = normText(coerceText(raw))
      const b = normText(coerceText(condition.value))
      if (b === '') return true
      return a.startsWith(b)
    }
    case 'text-ends-with': {
      const a = normText(coerceText(raw))
      const b = normText(coerceText(condition.value))
      if (b === '') return true
      return a.endsWith(b)
    }

    // --- Number operators ---
    case 'num-eq':
    case 'num-neq':
    case 'num-gt':
    case 'num-gte':
    case 'num-lt':
    case 'num-lte': {
      const a = coerceNumber(raw)
      const b = asNumber(condition.value)
      if (a === null || b === null) return false
      switch (condition.operator) {
        case 'num-eq':
          return a === b
        case 'num-neq':
          return a !== b
        case 'num-gt':
          return a > b
        case 'num-gte':
          return a >= b
        case 'num-lt':
          return a < b
        case 'num-lte':
          return a <= b
      }
      return false
    }
    case 'num-between': {
      const a = coerceNumber(raw)
      const pair = Array.isArray(condition.value) ? condition.value : []
      const lo = asNumber(pair[0])
      const hi = asNumber(pair[1])
      if (a === null || lo === null || hi === null) return false
      const [min, max] = lo <= hi ? [lo, hi] : [hi, lo]
      return a >= min && a <= max
    }

    // --- Boolean operators ---
    // Boolean columns never appear "empty" (coerceBoolean maps everything
    // to true/false), so these two operators run straight from the raw value.
    case 'bool-checked':
      return coerceBoolean(raw) === true
    case 'bool-unchecked':
      return coerceBoolean(raw) === false

    // --- Date operators (single + date-range) ---
    case 'date-on':
    case 'date-before':
    case 'date-after': {
      const rowDate = column.type === 'date-range' ? dateRangeAnchor(raw) : coerceDateString(raw)
      const target = asDate(condition.value)
      if (!rowDate || !target) return false
      if (condition.operator === 'date-on') return rowDate === target
      if (condition.operator === 'date-before') return rowDate < target
      return rowDate > target
    }
    case 'date-between': {
      const rowDate = column.type === 'date-range' ? dateRangeAnchor(raw) : coerceDateString(raw)
      const pair = Array.isArray(condition.value) ? condition.value : []
      const loRaw = asDate(pair[0])
      const hiRaw = asDate(pair[1])
      if (!rowDate || !loRaw || !hiRaw) return false
      const [lo, hi] = loRaw <= hiRaw ? [loRaw, hiRaw] : [hiRaw, loRaw]
      return rowDate >= lo && rowDate <= hi
    }
    case 'date-is-today': {
      const rowDate = coerceDateString(raw)
      return rowDate !== '' && rowDate === todayISO()
    }
    case 'date-last-n-days': {
      const n = asNumber(condition.value)
      if (n === null || n < 0) return false
      const today = todayISO()
      const earliest = addDaysISO(today, -Math.floor(n))
      const rowDate = coerceDateString(raw)
      if (!rowDate) return false
      return rowDate >= earliest && rowDate <= today
    }
    case 'date-next-n-days': {
      const n = asNumber(condition.value)
      if (n === null || n < 0) return false
      const today = todayISO()
      const latest = addDaysISO(today, Math.floor(n))
      const rowDate = coerceDateString(raw)
      if (!rowDate) return false
      return rowDate >= today && rowDate <= latest
    }

    // --- Select (single) ---
    case 'select-is': {
      const a = coerceText(raw)
      const b = coerceText(condition.value)
      return a === b
    }
    case 'select-is-not': {
      const a = coerceText(raw)
      const b = coerceText(condition.value)
      return a !== b
    }

    // --- Multi-select / list ---
    case 'list-contains': {
      const items = coerceList(raw)
      const tokens = splitListTokens(condition.value)
      if (tokens.length === 0) return true
      // "contains any" — matches if at least one token is present.
      return tokens.some((t) => items.includes(t))
    }
    case 'list-not-contains': {
      const items = coerceList(raw)
      const tokens = splitListTokens(condition.value)
      if (tokens.length === 0) return true
      return !tokens.some((t) => items.includes(t))
    }
    case 'list-contains-all': {
      const items = coerceList(raw)
      const tokens = splitListTokens(condition.value)
      if (tokens.length === 0) return true
      return tokens.every((t) => items.includes(t))
    }

    default:
      return false
  }
}

/**
 * Apply a full filter state to a row array. Returns a new array (stable
 * order — we never reorder here; sorting happens in the next stage).
 *
 * Newly added rows survive a filter via filter-derived defaults injected at
 * `addRow` time (see `filterDefaults.ts`), not via an out-of-band whitelist.
 */
export function applyFilter(
  rows: DatabaseRow[],
  columns: DatabaseColumnSchema[],
  filter: DatabaseFilterState
): DatabaseRow[] {
  const conditions = filter.conditions
  if (conditions.length === 0) return rows

  // Build a columnId -> column lookup once.
  const byId = new Map<string, DatabaseColumnSchema>()
  for (const col of columns) byId.set(col.id, col)

  // Drop conditions whose column is missing (e.g. the column was deleted
  // since the filter was set). DatabaseTableView also cleans these up on
  // column delete/type change, but we defensively skip them here too.
  const active = conditions.filter((c) => byId.has(c.columnId))
  if (active.length === 0) return rows

  return rows.filter((row) => {
    // `and` combinator — every condition must pass.
    for (const cond of active) {
      const col = byId.get(cond.columnId)
      if (!col) continue
      if (!evaluateCondition(row, col, cond)) return false
    }
    return true
  })
}
