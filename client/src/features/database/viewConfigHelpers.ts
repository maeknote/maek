// Generic helpers for view configs that carry `sort` and `filter` fields.
//
// The table view uses `tableViewConfig.ts`; kanban, calendar, and timeline
// views all share the same sort/filter persistence shape and rely on these
// helpers to stay symmetric with the table implementation.

import { EMPTY_VIEW_STATE } from '@shared/database'
import type { DatabaseFilterState, DatabaseSortRule, DatabaseViewState } from '@shared/database'

/**
 * Merge a partial patch into an existing view config. Omitted keys keep
 * their previous value; explicitly passing `undefined` clears a key.
 *
 * Mirrors `mergeTableViewConfig` but works for any config shape.
 */
export function mergeViewConfig<T extends object>(prev: T | undefined, patch: Partial<T>): T {
  return { ...(prev ?? ({} as T)), ...patch }
}

/** Shape supported by any view that persists sort/filter alongside its own settings. */
export interface WithSortFilterConfig {
  sort?: DatabaseSortRule[]
  filter?: DatabaseFilterState
}

/** Extract the `DatabaseViewState` from a view config, filling in safe defaults. */
export function readViewState(config: WithSortFilterConfig | null | undefined): DatabaseViewState {
  if (!config)
    return { ...EMPTY_VIEW_STATE, filter: { ...EMPTY_VIEW_STATE.filter, conditions: [] } }
  return {
    sort: config.sort ?? [],
    filter: config.filter ?? { combinator: 'and', conditions: [] }
  }
}
