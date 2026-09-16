// applyKanbanDrop — pure reducer: (snapshot, DropResult) → next state + IPC payload.
//
// Only card drags are supported. Two branches:
//
//   1. card same-lane → reorder the source lane's rows; yaml unchanged.
//   2. card x-lane    → remove from src, insert into dst; update yaml value.
//
// Any drop outside a valid target, a cancellation, or a same-position drop
// returns null (no-op). The caller must early-return and not commit.

import type { DropResult } from '@hello-pangea/dnd'
import type { DatabaseColumnSchema, DatabaseRow } from '@shared/database'
import { DRAG_TYPE_CARD, UNCATEGORIZED, parseLaneDroppableId } from './constants'
import type { KanbanDropOutcome, KanbanSnapshot } from './types'

export interface DropIdentity {
  workspacePath: string
  databaseId: string
}

export function applyKanbanDrop(
  snapshot: KanbanSnapshot,
  result: DropResult,
  identity: DropIdentity
): KanbanDropOutcome | null {
  if (result.reason === 'CANCEL') return null
  const { source, destination, type, draggableId } = result
  if (!destination) return null
  if (source.droppableId === destination.droppableId && source.index === destination.index) {
    return null
  }

  if (type !== DRAG_TYPE_CARD) return null

  const srcLane = parseLaneDroppableId(source.droppableId)
  const dstLane = parseLaneDroppableId(destination.droppableId)
  if (srcLane === null || dstLane === null) return null
  return handleCardMove(snapshot, draggableId, srcLane, dstLane, destination.index, identity)
}

function handleCardMove(
  snapshot: KanbanSnapshot,
  cardId: string,
  srcLane: string,
  dstLane: string,
  dstIdx: number,
  id: DropIdentity
): KanbanDropOutcome | null {
  const lanes = groupRowsByLane(snapshot.rows, snapshot.laneOptions, snapshot.groupColumn)
  const srcLaneRows = lanes.get(srcLane)
  const dstLaneRows = lanes.get(dstLane)
  if (!srcLaneRows || !dstLaneRows) return null

  const srcCardIdx = srcLaneRows.findIndex((r) => r.id === cardId)
  if (srcCardIdx < 0) return null

  const [removed] = srcLaneRows.splice(srcCardIdx, 1)
  if (!removed) return null
  const crossLane = srcLane !== dstLane
  const moved = crossLane ? buildMovedRow(removed, snapshot.groupColumn.name, dstLane) : removed

  const clamped = Math.max(0, Math.min(dstIdx, dstLaneRows.length))
  dstLaneRows.splice(clamped, 0, moved)

  const flatRows: DatabaseRow[] = []
  for (const opt of snapshot.laneOptions) {
    const laneRows = lanes.get(opt)
    if (laneRows) flatRows.push(...laneRows)
  }
  flatRows.push(...(lanes.get(UNCATEGORIZED) ?? []))

  const nextRows = applySortOrder(flatRows)

  return {
    nextRows,
    payload: {
      workspacePath: id.workspacePath,
      databaseId: id.databaseId,
      rowMove: crossLane
        ? {
            rowId: cardId,
            groupColumnName: snapshot.groupColumn.name,
            // null = remove the field from yaml (drop onto No Value lane).
            newValue: dstLane === UNCATEGORIZED ? null : dstLane
          }
        : null,
      orderedRowIds: nextRows.map((r) => r.id)
    }
  }
}

/** Apply the optimistic local-state mutation for a cross-lane move:
 *  drop into No Value removes the field; drop into a real lane sets it. */
function buildMovedRow(row: DatabaseRow, columnName: string, dstLane: string): DatabaseRow {
  if (dstLane === UNCATEGORIZED) {
    const nextYaml = { ...row.yamlData }
    delete nextYaml[columnName]
    return { ...row, yamlData: nextYaml }
  }
  return { ...row, yamlData: { ...row.yamlData, [columnName]: dstLane } }
}

/** Partition rows into lanes keyed by option value (with UNCATEGORIZED bucket),
 *  each lane internally sorted by sortOrder ascending (the display order). */
function groupRowsByLane(
  rows: DatabaseRow[],
  laneOptions: string[],
  groupColumn: DatabaseColumnSchema
): Map<string, DatabaseRow[]> {
  const lanes = new Map<string, DatabaseRow[]>()
  for (const opt of laneOptions) lanes.set(opt, [])
  lanes.set(UNCATEGORIZED, [])

  const sorted = [...rows].sort((a, b) => a.sortOrder - b.sortOrder)
  const optionSet = new Set(laneOptions)
  for (const row of sorted) {
    const raw = row.yamlData[groupColumn.name]
    const value = typeof raw === 'string' ? raw.trim() : ''
    const key = value && optionSet.has(value) ? value : UNCATEGORIZED
    lanes.get(key)!.push(row)
  }
  return lanes
}

/** Assign sortOrder = array index. Skips allocation when the value is unchanged. */
function applySortOrder(rows: DatabaseRow[]): DatabaseRow[] {
  return rows.map((r, i) => (r.sortOrder === i ? r : { ...r, sortOrder: i }))
}
