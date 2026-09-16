// Column aggregation helpers — compute summary values for the table footer.
//
// All aggregates are computed in the renderer against the already-fetched rows.
// SQLite is the index; the rows array we already have is authoritative for display.

import type {
  DatabaseAggregation,
  DatabaseColumnSchema,
  DatabaseColumnType,
  DatabaseRow
} from '@shared/database'
import {
  coerceBoolean,
  coerceDateString,
  coerceNumber,
  formatNumberValue,
  isEmpty,
  parseDateRange
} from './cellFormat'

interface AggregationOption {
  value: DatabaseAggregation
  label: string
}

/** Always-available baseline (count + the "no aggregation" entry). */
const COUNT_ONLY: AggregationOption[] = [
  { value: 'none', label: 'None' },
  { value: 'count', label: 'Count all' }
]

/**
 * Aggregations that depend on whether a value is "filled" — meaningful for
 * column types where missing values are a real possibility (text, number,
 * date, list, select). Booleans are intentionally excluded because a checkbox
 * is always either true or false (no "empty" state).
 */
const FILLABLE_AGGREGATIONS: AggregationOption[] = [
  ...COUNT_ONLY,
  { value: 'count-not-empty', label: 'Count values' },
  { value: 'count-empty', label: 'Count empty' },
  { value: 'count-unique', label: 'Count unique' },
  { value: 'percent-not-empty', label: '% filled' },
  { value: 'percent-empty', label: '% empty' }
]

/**
 * Options available for a column's type. Returned as an explicit per-type list
 * so each column only sees aggregations that actually make sense for its data.
 */
export function getAggregationOptions(type: DatabaseColumnType): AggregationOption[] {
  switch (type) {
    case 'boolean':
      return [
        ...COUNT_ONLY,
        { value: 'count-unique', label: 'Count unique' },
        { value: 'sum', label: 'Checked count' },
        { value: 'average', label: 'Checked ratio' }
      ]
    case 'number':
      return [
        ...FILLABLE_AGGREGATIONS,
        { value: 'sum', label: 'Sum' },
        { value: 'average', label: 'Average' },
        { value: 'min', label: 'Min' },
        { value: 'max', label: 'Max' },
        { value: 'median', label: 'Median' },
        { value: 'range', label: 'Range' }
      ]
    case 'date':
    case 'date-range':
      return [
        ...FILLABLE_AGGREGATIONS,
        { value: 'earliest', label: 'Earliest' },
        { value: 'latest', label: 'Latest' },
        { value: 'date-range-span', label: 'Date range (days)' }
      ]
    case 'text':
    case 'select':
    case 'multi-select':
    case 'list':
    default:
      return FILLABLE_AGGREGATIONS
  }
}

function extractValues(rows: DatabaseRow[], columnName: string): unknown[] {
  return rows.map((r) => r.yamlData[columnName])
}

function extractNumbers(
  rows: DatabaseRow[],
  columnName: string,
  type: DatabaseColumnType
): number[] {
  const out: number[] = []
  for (const row of rows) {
    const raw = row.yamlData[columnName]
    if (type === 'boolean') {
      // For boolean columns, false counts as 0 and true as 1.
      // null/undefined are skipped (the value is genuinely missing).
      if (raw === null || raw === undefined) continue
      out.push(coerceBoolean(raw) ? 1 : 0)
      continue
    }
    const n = coerceNumber(raw)
    if (n !== null) out.push(n)
  }
  return out
}

function extractDateTimestamps(
  rows: DatabaseRow[],
  columnName: string,
  type: DatabaseColumnType
): number[] {
  const out: number[] = []
  for (const row of rows) {
    const raw = row.yamlData[columnName]
    if (type === 'date-range') {
      const range = parseDateRange(raw)
      if (range.start) {
        const t = Date.parse(range.start)
        if (Number.isFinite(t)) out.push(t)
      }
      if (range.end) {
        const t = Date.parse(range.end)
        if (Number.isFinite(t)) out.push(t)
      }
    } else {
      const s = coerceDateString(raw)
      if (s) {
        const t = Date.parse(s)
        if (Number.isFinite(t)) out.push(t)
      }
    }
  }
  return out
}

function formatAggregateNumber(value: number, column: DatabaseColumnSchema): string {
  if (!Number.isFinite(value)) return ''
  // Number columns honor the column's display format. Boolean columns always
  // render their numeric aggregates as plain integers / decimals.
  if (column.type === 'number') {
    return formatNumberValue(value, column.numberFormat)
  }
  if (Number.isInteger(value)) return String(value)
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

function formatDate(ts: number | undefined): string {
  if (ts === undefined || !Number.isFinite(ts)) return ''
  return new Date(ts).toISOString().slice(0, 10)
}

function sum(values: number[]): number {
  let total = 0
  for (const v of values) total += v
  return total
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

/** Compute the aggregation label for a single column. Empty string means "nothing to show". */
export function computeAggregation(rows: DatabaseRow[], column: DatabaseColumnSchema): string {
  const fn = column.aggregation ?? 'none'
  if (fn === 'none') return ''
  const total = rows.length

  if (fn === 'count') return String(total)

  const rawValues = extractValues(rows, column.name)
  const emptyCount = rawValues.filter((v) => isEmpty(v, column.type)).length
  const notEmptyCount = total - emptyCount

  switch (fn) {
    case 'count-empty':
      return String(emptyCount)
    case 'count-not-empty':
      return String(notEmptyCount)
    case 'count-unique': {
      const seen = new Set<string>()
      for (const v of rawValues) {
        if (isEmpty(v, column.type)) continue
        try {
          seen.add(JSON.stringify(v))
        } catch {
          seen.add(String(v))
        }
      }
      return String(seen.size)
    }
    case 'percent-empty':
      return total === 0 ? '0%' : `${Math.round((emptyCount / total) * 100)}%`
    case 'percent-not-empty':
      return total === 0 ? '0%' : `${Math.round((notEmptyCount / total) * 100)}%`
    default:
      break
  }

  // Numeric aggregations apply to both number and boolean columns
  // (boolean: true → 1, false → 0).
  if (column.type === 'number' || column.type === 'boolean') {
    const nums = extractNumbers(rows, column.name, column.type)
    if (nums.length === 0) return ''
    // For boolean columns we override the label semantics: average → percentage.
    if (column.type === 'boolean' && fn === 'average') {
      const ratio = sum(nums) / nums.length
      return `${Math.round(ratio * 100)}%`
    }
    switch (fn) {
      case 'sum':
        return formatAggregateNumber(sum(nums), column)
      case 'average':
        return formatAggregateNumber(sum(nums) / nums.length, column)
      case 'min':
        return formatAggregateNumber(Math.min(...nums), column)
      case 'max':
        return formatAggregateNumber(Math.max(...nums), column)
      case 'median':
        return formatAggregateNumber(median(nums), column)
      case 'range':
        return formatAggregateNumber(Math.max(...nums) - Math.min(...nums), column)
      default:
        return ''
    }
  }

  // Date-only aggregations
  if (column.type === 'date' || column.type === 'date-range') {
    const timestamps = extractDateTimestamps(rows, column.name, column.type)
    if (timestamps.length === 0) return ''
    switch (fn) {
      case 'earliest':
        return formatDate(Math.min(...timestamps))
      case 'latest':
        return formatDate(Math.max(...timestamps))
      case 'date-range-span': {
        const span = Math.max(...timestamps) - Math.min(...timestamps)
        const days = Math.round(span / (1000 * 60 * 60 * 24))
        return `${days} days`
      }
      default:
        return ''
    }
  }

  return ''
}
