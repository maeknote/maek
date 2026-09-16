// Helpers for the table view's persisted UI configuration.
//
// `TableViewConfig` lives inside `DatabaseMeta.viewConfig` on the `'table'`
// variant and carries column order, sort rules, and filter state — all
// persisted on the active named view through the `DB_UPDATE_VIEW` IPC.

import type { DatabaseColumnSchema, TableViewConfig } from '@shared/database'

/**
 * Resolve the effective column order for rendering.
 *
 * Starts from the persisted `columnOrder` id list, drops ids no longer
 * present in the schema (columns deleted since the preference was saved),
 * then appends any schema columns missing from the preference in their
 * `schema.order` sequence so brand-new columns appear at the tail.
 *
 * Pure function — callers can safely call it inside `useMemo`.
 */
export function resolveColumnOrder(
  schema: DatabaseColumnSchema[],
  columnOrder: string[] | undefined
): DatabaseColumnSchema[] {
  const byId = new Map(schema.map((c) => [c.id, c]))
  const schemaSorted = [...schema].sort((a, b) => a.order - b.order)

  if (!columnOrder || columnOrder.length === 0) {
    return schemaSorted
  }

  const seen = new Set<string>()
  const ordered: DatabaseColumnSchema[] = []
  for (const id of columnOrder) {
    const col = byId.get(id)
    if (col && !seen.has(id)) {
      ordered.push(col)
      seen.add(id)
    }
  }
  for (const col of schemaSorted) {
    if (!seen.has(col.id)) ordered.push(col)
  }
  return ordered
}

/**
 * Merge a partial patch into the current table config. Omitted keys retain
 * their previous value; explicitly passing `undefined` clears a key.
 */
export function mergeTableViewConfig(
  prev: TableViewConfig | undefined,
  patch: Partial<TableViewConfig>
): TableViewConfig {
  return { ...(prev ?? {}), ...patch }
}
