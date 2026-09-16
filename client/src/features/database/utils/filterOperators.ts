// filterOperators - Column-type × filter-operator compatibility matrix.
//
// This module is the single source of truth for:
//   · which operators are allowed for each column type
//   · the default operator to preselect when adding a filter
//   · a human-readable label for the operator select in FilterEditor
//   · which value-input widget (`ValueInputKind`) a given operator needs
//
// Keeping all of this here means the runtime evaluator (`filterEvaluator.ts`)
// and the UI (`FilterEditor.tsx`) only need to look up one table to stay in
// sync with the type union in `shared/types.ts`.

import type { DatabaseColumnType, DatabaseFilterOperator } from '@shared/database'

/**
 * What kind of value input a given operator needs.
 *   · none          — operator takes no value (is-empty, bool-checked, ...)
 *   · text          — single free-text string (contains, equals, ...)
 *   · number        — single numeric input
 *   · number-pair   — two numeric inputs (between)
 *   · number-n      — single integer ≥ 0 (last/next N days)
 *   · date          — single ISO date (YYYY-MM-DD)
 *   · date-pair     — two ISO dates (between)
 *   · select-one    — pick one option from the column's `options` array
 */
export type ValueInputKind =
  | 'none'
  | 'text'
  | 'number'
  | 'number-pair'
  | 'number-n'
  | 'date'
  | 'date-pair'
  | 'select-one'

/** Allowed operators keyed by column type. Order controls dropdown order. */
export const OPERATORS_BY_TYPE: Record<DatabaseColumnType, DatabaseFilterOperator[]> = {
  text: [
    'text-contains',
    'text-not-contains',
    'text-equals',
    'text-not-equals',
    'text-starts-with',
    'text-ends-with',
    'is-empty',
    'is-not-empty'
  ],
  number: [
    'num-eq',
    'num-neq',
    'num-gt',
    'num-gte',
    'num-lt',
    'num-lte',
    'num-between',
    'is-empty',
    'is-not-empty'
  ],
  boolean: ['bool-checked', 'bool-unchecked'],
  date: [
    'date-on',
    'date-before',
    'date-after',
    'date-between',
    'date-is-today',
    'date-last-n-days',
    'date-next-n-days',
    'is-empty',
    'is-not-empty'
  ],
  'date-range': [
    'date-on',
    'date-before',
    'date-after',
    'date-between',
    'is-empty',
    'is-not-empty'
  ],
  select: ['select-is', 'select-is-not', 'is-empty', 'is-not-empty'],
  'multi-select': [
    'list-contains',
    'list-not-contains',
    'list-contains-all',
    'is-empty',
    'is-not-empty'
  ],
  list: ['list-contains', 'list-not-contains', 'list-contains-all', 'is-empty', 'is-not-empty']
}

/** Whether `op` is a valid operator choice for `type`. */
export function isOperatorAllowed(type: DatabaseColumnType, op: DatabaseFilterOperator): boolean {
  return OPERATORS_BY_TYPE[type]?.includes(op) ?? false
}

/**
 * The operator to preselect when the user first opens the filter editor for
 * a column. Uses the first entry in the allowed list for that type, which is
 * chosen to be the "most expected" filter (e.g. `text-contains` for text).
 */
export function defaultOperatorForType(type: DatabaseColumnType): DatabaseFilterOperator {
  const list = OPERATORS_BY_TYPE[type]
  return list[0]!
}

/** Short human label used inside the Filter submenu's operator dropdown. */
export function operatorLabel(op: DatabaseFilterOperator): string {
  switch (op) {
    // Common
    case 'is-empty':
      return 'Is empty'
    case 'is-not-empty':
      return 'Is not empty'
    // Text
    case 'text-contains':
      return 'Contains'
    case 'text-not-contains':
      return "Doesn't contain"
    case 'text-equals':
      return 'Equals'
    case 'text-not-equals':
      return "Doesn't equal"
    case 'text-starts-with':
      return 'Starts with'
    case 'text-ends-with':
      return 'Ends with'
    // Number
    case 'num-eq':
      return '='
    case 'num-neq':
      return '≠'
    case 'num-gt':
      return '>'
    case 'num-gte':
      return '≥'
    case 'num-lt':
      return '<'
    case 'num-lte':
      return '≤'
    case 'num-between':
      return 'Between'
    // Boolean
    case 'bool-checked':
      return 'Is checked'
    case 'bool-unchecked':
      return 'Is unchecked'
    // Date
    case 'date-on':
      return 'On'
    case 'date-before':
      return 'Before'
    case 'date-after':
      return 'After'
    case 'date-between':
      return 'Between'
    case 'date-is-today':
      return 'Today'
    case 'date-last-n-days':
      return 'Last N days'
    case 'date-next-n-days':
      return 'Next N days'
    // Select
    case 'select-is':
      return 'Is'
    case 'select-is-not':
      return 'Is not'
    // Multi-select / list
    case 'list-contains':
      return 'Contains'
    case 'list-not-contains':
      return "Doesn't contain"
    case 'list-contains-all':
      return 'Contains all of'
    default:
      return op
  }
}

/** Which value-input widget an operator needs in FilterEditor. */
export function operatorValueKind(op: DatabaseFilterOperator): ValueInputKind {
  switch (op) {
    // No argument
    case 'is-empty':
    case 'is-not-empty':
    case 'bool-checked':
    case 'bool-unchecked':
    case 'date-is-today':
      return 'none'
    // Text arguments
    case 'text-equals':
    case 'text-not-equals':
    case 'text-contains':
    case 'text-not-contains':
    case 'text-starts-with':
    case 'text-ends-with':
    case 'list-contains':
    case 'list-not-contains':
    case 'list-contains-all':
      return 'text'
    // Number arguments
    case 'num-eq':
    case 'num-neq':
    case 'num-gt':
    case 'num-gte':
    case 'num-lt':
    case 'num-lte':
      return 'number'
    case 'num-between':
      return 'number-pair'
    case 'date-last-n-days':
    case 'date-next-n-days':
      return 'number-n'
    // Date arguments
    case 'date-on':
    case 'date-before':
    case 'date-after':
      return 'date'
    case 'date-between':
      return 'date-pair'
    // Single-select pick
    case 'select-is':
    case 'select-is-not':
      return 'select-one'
    default:
      return 'none'
  }
}
