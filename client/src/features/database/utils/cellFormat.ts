// Cell value helpers — coercion / formatting / emptiness checks.
//
// The renderer is the source of truth for interpreting YAML values according
// to the column's declared type. Parsing is permissive: any value that cannot
// be coerced cleanly is treated as the type's empty value.

import type {
  DatabaseColumnSchema,
  DatabaseColumnType,
  DatabaseDateRangeValue,
  NumberFormat
} from '@shared/database'

/** Render a number according to the column's number format. */
export function formatNumberValue(value: number, format: NumberFormat | undefined): string {
  if (!Number.isFinite(value)) return ''
  switch (format) {
    case 'integer':
      return Math.round(value).toLocaleString()
    case 'decimal':
      return value.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })
    case 'percent':
      return `${(value * 100).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      })}%`
    case 'currency-usd':
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
      }).format(value)
    case 'currency-krw':
      return new Intl.NumberFormat('ko-KR', {
        style: 'currency',
        currency: 'KRW',
        maximumFractionDigits: 0
      }).format(value)
    case 'plain':
    default: {
      // Drop unnecessary trailing zeros for plain format.
      if (Number.isInteger(value)) return String(value)
      return value.toLocaleString(undefined, { maximumFractionDigits: 6 })
    }
  }
}

/** Is the given value considered "empty" for aggregation/display purposes? */
export function isEmpty(value: unknown, type?: DatabaseColumnType): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  if (type === 'date-range') {
    const range = parseDateRange(value)
    return range.start === null && range.end === null
  }
  return false
}

/** Coerce to string for text columns. */
export function coerceText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

/** Coerce to number. Returns null if not a finite number. */
export function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** Coerce to boolean. Strings like 'true' / 'false' / '1' / '0' are honored. */
export function coerceBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === 'yes' || normalized === '1') return true
    return false
  }
  return false
}

/** Coerce to ISO date string (YYYY-MM-DD). Returns empty string on failure. */
export function coerceDateString(value: unknown): string {
  if (!value) return ''
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return ''
    return value.toISOString().slice(0, 10)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return ''
    // Accept YYYY-MM-DD directly.
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
    const parsed = new Date(trimmed)
    if (Number.isNaN(parsed.getTime())) return ''
    return parsed.toISOString().slice(0, 10)
  }
  return ''
}

/** Parse a date-range value from arbitrary YAML input. */
export function parseDateRange(value: unknown): DatabaseDateRangeValue {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    return {
      start: coerceDateString(obj.start) || null,
      end: coerceDateString(obj.end) || null
    }
  }
  return { start: null, end: null }
}

/** Coerce to a string[] for list / multi-select columns. */
export function coerceList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v) => typeof v === 'string' || typeof v === 'number').map((v) => String(v))
  }
  if (typeof value === 'string' && value.trim() !== '') return [value]
  return []
}

/**
 * Format a value as read-only text for non-editor display (table cells, card
 * previews, etc.). `boolean` and `multi-select` return an empty string because
 * those types render custom UI (checkbox / chip row) rather than a text span.
 */
export function formatDisplay(column: DatabaseColumnSchema, value: unknown): string {
  switch (column.type) {
    case 'number': {
      const n = coerceNumber(value)
      return n === null ? '' : formatNumberValue(n, column.numberFormat)
    }
    case 'boolean':
      return ''
    case 'date':
      return coerceDateString(value)
    case 'date-range': {
      const range = parseDateRange(value)
      if (!range.start && !range.end) return ''
      return `${range.start ?? '…'} → ${range.end ?? '…'}`
    }
    case 'list':
      return coerceList(value).join(', ')
    case 'multi-select':
      return ''
    case 'select':
      return coerceText(value)
    default:
      return coerceText(value)
  }
}

/** Today's date as an ISO string in the local timezone. */
export function todayISO(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Add `days` to an ISO date string. Returns '' if input is invalid. */
export function addDaysISO(dateStr: string, days: number): string {
  if (!dateStr) return ''
  const d = new Date(`${dateStr}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Default empty value for a given column type (used when adding new rows). */
export function defaultValueForType(type: DatabaseColumnType): unknown {
  switch (type) {
    case 'boolean':
      return false
    case 'number':
      return null
    case 'list':
    case 'multi-select':
      return []
    case 'date-range':
      return { start: null, end: null }
    default:
      return ''
  }
}
