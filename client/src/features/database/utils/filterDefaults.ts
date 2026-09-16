// filterDefaults — derive a partial row payload from an active filter so a
// newly added row naturally satisfies every condition. Used by all four
// database views (Table / Kanban / Timeline / Calendar) when handling
// `+ New`, replacing the older `pendingRowIds` whitelist mechanism.
//
// Invariant carried over from `filterEvaluator.ts`: an "empty" cell never
// matches non-empty operators (including negations), so for negative /
// is-not-empty operators we must produce a minimal placeholder value rather
// than leaving the column unset.

import type {
  DatabaseColumnSchema,
  DatabaseFilterCondition,
  DatabaseFilterOperator,
  DatabaseFilterState
} from '@shared/database'
import { addDaysISO, defaultValueForType, todayISO } from './cellFormat'
import { evaluateCondition } from './filterEvaluator'

/** Comma-separated list of tokens, mirroring `filterEvaluator.splitListTokens`. */
function splitListTokens(value: unknown): string[] {
  const raw = typeof value === 'string' ? value : ''
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = Number(value.trim())
    return Number.isFinite(n) ? n : null
  }
  return null
}

function asDateString(value: unknown): string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''
}

/**
 * Resolve a date column's value by intersecting every date condition into a
 * closed [lo, hi] interval and picking the date in that interval closest to
 * today. Returns `null` when no date conditions exist or the column is
 * `is-empty`-locked. Returns `''` when the only condition is `is-empty`.
 */
function deriveDateValue(conditions: DatabaseFilterCondition[]): string | null {
  if (conditions.length === 0) return null

  const today = todayISO()
  const NEG_INF = '' // any '' is less than any 'YYYY-...' string
  const POS_INF = '9999-12-31'

  let lo = NEG_INF
  let hi = POS_INF
  let isEmptyLock = false
  let hadAny = false

  for (const cond of conditions) {
    let condLo = NEG_INF
    let condHi = POS_INF
    switch (cond.operator) {
      case 'date-on': {
        const x = asDateString(cond.value)
        if (!x) continue
        condLo = x
        condHi = x
        break
      }
      case 'date-before': {
        const x = asDateString(cond.value)
        if (!x) continue
        condHi = addDaysISO(x, -1) || NEG_INF
        break
      }
      case 'date-after': {
        const x = asDateString(cond.value)
        if (!x) continue
        condLo = addDaysISO(x, 1) || POS_INF
        break
      }
      case 'date-between': {
        const pair = Array.isArray(cond.value) ? cond.value : []
        const a = asDateString(pair[0])
        const b = asDateString(pair[1])
        if (!a || !b) continue
        condLo = a <= b ? a : b
        condHi = a <= b ? b : a
        break
      }
      case 'date-is-today': {
        condLo = today
        condHi = today
        break
      }
      case 'date-last-n-days': {
        const n = asNumber(cond.value)
        if (n === null || n < 0) continue
        condLo = addDaysISO(today, -Math.floor(n)) || NEG_INF
        condHi = today
        break
      }
      case 'date-next-n-days': {
        const n = asNumber(cond.value)
        if (n === null || n < 0) continue
        condLo = today
        condHi = addDaysISO(today, Math.floor(n)) || POS_INF
        break
      }
      case 'is-empty': {
        isEmptyLock = true
        continue
      }
      case 'is-not-empty': {
        // Any non-empty date works; today is the natural pick.
        condLo = today
        condHi = today
        break
      }
      default:
        continue
    }
    hadAny = true
    if (condLo > lo) lo = condLo
    if (condHi < hi) hi = condHi
  }

  if (isEmptyLock) return ''
  if (!hadAny) return null

  // Infeasible intersection — fall back to the closer bound.
  if (lo > hi) {
    const today2 = today
    const dLo = lo === NEG_INF ? Infinity : Math.abs(diffDays(today2, lo))
    const dHi = hi === POS_INF ? Infinity : Math.abs(diffDays(today2, hi))
    if (dLo <= dHi && lo !== NEG_INF) return lo
    if (hi !== POS_INF) return hi
    return today
  }

  if (today >= lo && today <= hi) return today
  if (today < lo) return lo
  return hi
}

function diffDays(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime()
  const db = new Date(`${b}T00:00:00Z`).getTime()
  if (!Number.isFinite(da) || !Number.isFinite(db)) return 0
  return Math.round((da - db) / 86400000)
}

/**
 * Derive a candidate value for a single non-date condition. Returns
 * `undefined` when the operator is unknown or its operand is missing — the
 * caller skips such conditions, leaving the column at the type's default.
 */
function deriveSingleValue(column: DatabaseColumnSchema, cond: DatabaseFilterCondition): unknown {
  const op: DatabaseFilterOperator = cond.operator
  const v = cond.value

  // Common emptiness operators handled per-type because the placeholder
  // depends on the column type.
  if (op === 'is-empty') return defaultValueForType(column.type)
  if (op === 'is-not-empty') {
    switch (column.type) {
      case 'text':
        return '_'
      case 'number':
        return 0
      case 'boolean':
        return true
      case 'select':
        return column.options?.[0] ?? '_'
      case 'multi-select':
      case 'list':
        return [column.options?.[0] ?? '_']
      // date / date-range handled in deriveDateValue
      default:
        return undefined
    }
  }

  switch (column.type) {
    case 'text': {
      const x = typeof v === 'string' ? v : ''
      switch (op) {
        case 'text-equals':
        case 'text-contains':
        case 'text-starts-with':
        case 'text-ends-with':
          return x
        case 'text-not-equals':
          return x === '_' ? '_x' : '_'
        case 'text-not-contains':
          return x.includes('_') ? ' .' : '_'
        default:
          return undefined
      }
    }

    case 'number': {
      const x = asNumber(v)
      switch (op) {
        case 'num-eq':
        case 'num-gte':
        case 'num-lte':
          return x
        case 'num-gt':
          return x === null ? null : x + 1
        case 'num-lt':
          return x === null ? null : x - 1
        case 'num-neq':
          return x === 0 ? 1 : 0
        case 'num-between': {
          const pair = Array.isArray(v) ? v : []
          const lo = asNumber(pair[0])
          const hi = asNumber(pair[1])
          if (lo === null || hi === null) return undefined
          return lo <= hi ? lo : hi
        }
        default:
          return undefined
      }
    }

    case 'boolean': {
      if (op === 'bool-checked') return true
      if (op === 'bool-unchecked') return false
      return undefined
    }

    case 'select': {
      const x = typeof v === 'string' ? v : ''
      if (op === 'select-is') return x
      if (op === 'select-is-not') {
        const fallback = column.options?.find((o) => o !== x)
        return fallback ?? '_'
      }
      return undefined
    }

    case 'multi-select':
    case 'list': {
      const tokens = splitListTokens(v)
      if (op === 'list-contains') return tokens.length > 0 ? [tokens[0]] : []
      if (op === 'list-contains-all') return tokens
      if (op === 'list-not-contains') {
        const fallback = column.options?.find((o) => !tokens.includes(o))
        return fallback ? [fallback] : ['_']
      }
      return undefined
    }

    default:
      return undefined
  }
}

/**
 * Build a partial row payload (`{ columnName: value }`) such that any row
 * created with these values, merged with column-default empties, satisfies
 * every condition in the active filter.
 */
export function deriveDefaultsFromFilter(
  filter: DatabaseFilterState,
  columns: DatabaseColumnSchema[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  if (filter.conditions.length === 0) return result

  // Group conditions by columnId, dropping ones whose column has been deleted.
  const colsById = new Map<string, DatabaseColumnSchema>()
  for (const c of columns) colsById.set(c.id, c)

  const grouped = new Map<string, DatabaseFilterCondition[]>()
  for (const cond of filter.conditions) {
    if (!colsById.has(cond.columnId)) continue
    const arr = grouped.get(cond.columnId) ?? []
    arr.push(cond)
    grouped.set(cond.columnId, arr)
  }

  for (const [columnId, conds] of grouped) {
    const column = colsById.get(columnId)
    if (!column) continue

    if (column.type === 'date' || column.type === 'date-range') {
      const dateValue = deriveDateValue(conds)
      if (dateValue === null) continue
      result[column.name] =
        column.type === 'date-range'
          ? dateValue === ''
            ? { start: null, end: null }
            : { start: dateValue, end: dateValue }
          : dateValue
      continue
    }

    // Non-date: process in order, refining if needed. The new row is
    // synthesized just to feed evaluateCondition for satisfaction checks.
    let current: unknown = undefined
    for (const cond of conds) {
      const candidate = deriveSingleValue(column, cond)
      if (candidate === undefined) continue
      if (current === undefined) {
        current = candidate
        continue
      }
      // Check whether the existing value still satisfies this new condition.
      const probe = makeProbeRow(column, current)
      if (evaluateCondition(probe, column, cond)) continue
      // It doesn't — switch to the new candidate.
      current = candidate
    }
    if (current !== undefined) result[column.name] = current
  }

  return result
}

/** Synthesize a one-cell row for `evaluateCondition` re-checks. */
function makeProbeRow(
  column: DatabaseColumnSchema,
  value: unknown
): Parameters<typeof evaluateCondition>[0] {
  return {
    id: '__probe__',
    yamlData: { [column.name]: value }
  } as Parameters<typeof evaluateCondition>[0]
}
