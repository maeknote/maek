// rowSort - Type-aware row comparators for the database table view.
//
// Sort semantics (Phase 1 — single column, but the public API takes an
// array of rules so multi-sort can be enabled later without churn):
//   · Empty values are always placed at the end, regardless of direction
//     — this matches what users expect from spreadsheet / Notion sorting
//     (asc with empties on top is never what you want).
//   · Ties fall through to the next rule.
//   · Sort is stable: `Array.prototype.sort` is stable per the ES2019 spec
//     in every browser runtime we ship against, so equal rows preserve the
//     upstream (filtered) order.

import type {
  DatabaseColumnSchema,
  DatabaseRow,
  DatabaseSortRule,
  SortDirection
} from '@shared/database'
import {
  coerceBoolean,
  coerceDateString,
  coerceList,
  coerceNumber,
  coerceText,
  isEmpty,
  parseDateRange
} from './cellFormat'

type Comparator = (a: DatabaseRow, b: DatabaseRow) => number

/**
 * Sentinel column id for the row's title. Title is not a real schema
 * column — it's derived from `DatabaseRow.fileName` — so we expose it to
 * the sort pipeline via a virtual column with this reserved id.
 *
 * The sentinel starts and ends with underscores, a prefix no user-created
 * column id (UUID) can produce.
 */
export const TITLE_SORT_COLUMN_ID = '__title__'

/** Build the virtual "Title" column used by the sort UI and pipeline. */
export function createTitleSortColumn(label = 'Title'): DatabaseColumnSchema {
  return {
    id: TITLE_SORT_COLUMN_ID,
    name: label,
    type: 'text',
    // Virtual column; `order` is unused because it never lives in the
    // persisted schema array. -1 makes it obvious if it ever leaks.
    order: -1
  }
}

/** Extract the raw value used by sort for a given column. */
function getSortValue(row: DatabaseRow, column: DatabaseColumnSchema): unknown {
  if (column.id === TITLE_SORT_COLUMN_ID) {
    return row.fileName.replace(/\.md$/i, '')
  }
  return row.yamlData[column.name]
}

/**
 * Build a comparator for one sort rule. The returned function is safe to
 * compose (see `applySort`) and handles empties uniformly: a row whose
 * value is empty always sorts after a row whose value is non-empty.
 */
export function makeColumnComparator(
  column: DatabaseColumnSchema,
  direction: SortDirection
): Comparator {
  const dir = direction === 'desc' ? -1 : 1

  return (rowA, rowB) => {
    const rawA = getSortValue(rowA, column)
    const rawB = getSortValue(rowB, column)
    const emptyA = isEmpty(rawA, column.type)
    const emptyB = isEmpty(rawB, column.type)

    // Empty handling: empties always go last, direction-independent.
    if (emptyA && emptyB) return 0
    if (emptyA) return 1
    if (emptyB) return -1

    let cmp = 0
    switch (column.type) {
      case 'number': {
        const a = coerceNumber(rawA) ?? 0
        const b = coerceNumber(rawB) ?? 0
        cmp = a - b
        break
      }
      case 'boolean': {
        // false < true, so an ascending sort surfaces unchecked rows first.
        const a = coerceBoolean(rawA) ? 1 : 0
        const b = coerceBoolean(rawB) ? 1 : 0
        cmp = a - b
        break
      }
      case 'date': {
        // ISO YYYY-MM-DD strings compare lexicographically.
        cmp = compareStrings(coerceDateString(rawA), coerceDateString(rawB))
        break
      }
      case 'date-range': {
        // Anchor on the start date; fall back to end. Already guaranteed
        // non-empty here by the emptiness short-circuit above.
        const a = parseDateRange(rawA)
        const b = parseDateRange(rawB)
        const aKey = a.start ?? a.end ?? ''
        const bKey = b.start ?? b.end ?? ''
        cmp = compareStrings(aKey, bKey)
        break
      }
      case 'select': {
        // Sort by the column's option order when possible (so "Low →
        // Medium → High → Urgent" stays in intended order), falling back
        // to a plain string compare if an option is unknown.
        const options = column.options ?? []
        const a = coerceText(rawA)
        const b = coerceText(rawB)
        const ia = options.indexOf(a)
        const ib = options.indexOf(b)
        if (ia !== -1 && ib !== -1) cmp = ia - ib
        else if (ia !== -1) cmp = -1
        else if (ib !== -1) cmp = 1
        else cmp = compareStrings(a, b)
        break
      }
      case 'multi-select':
      case 'list': {
        // Lexicographic compare on the joined-list representation so the
        // order is stable for users even though there is no natural order.
        const a = coerceList(rawA).join(', ')
        const b = coerceList(rawB).join(', ')
        cmp = compareStrings(a, b)
        break
      }
      case 'text':
      default: {
        cmp = compareStrings(coerceText(rawA), coerceText(rawB))
        break
      }
    }

    return cmp * dir
  }
}

/**
 * Locale-aware, numeric-friendly string compare. `numeric: true` makes
 * `item2 < item10` instead of the lexicographic `item10 < item2`, and
 * `sensitivity: 'base'` means `a === A` for sort purposes.
 */
function compareStrings(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
}

/**
 * Apply an array of sort rules to `rows`. Rules are applied in order —
 * the first rule is primary, ties fall through to the second, and so on.
 * Returns a new array; the input array is not mutated.
 */
export function applySort(
  rows: DatabaseRow[],
  columns: DatabaseColumnSchema[],
  sort: DatabaseSortRule[]
): DatabaseRow[] {
  if (sort.length === 0) return rows

  // Build comparators for each rule, skipping rules whose column has been
  // removed (defensive — DatabaseTableView also cleans these up). The
  // virtual title column is not part of the schema, so register it here
  // so a `__title__` sort rule resolves without requiring every caller to
  // inject the virtual column into their columns array.
  const byId = new Map<string, DatabaseColumnSchema>()
  byId.set(TITLE_SORT_COLUMN_ID, createTitleSortColumn())
  for (const col of columns) byId.set(col.id, col)

  const comparators: Comparator[] = []
  for (const rule of sort) {
    const col = byId.get(rule.columnId)
    if (!col) continue
    comparators.push(makeColumnComparator(col, rule.direction))
  }

  if (comparators.length === 0) return rows

  return [...rows].sort((a, b) => {
    for (const cmp of comparators) {
      const result = cmp(a, b)
      if (result !== 0) return result
    }
    return 0
  })
}
