// Kanban internal types.

import type {
  DatabaseApplyKanbanDropRequest,
  DatabaseColumnSchema,
  DatabaseRow
} from '@shared/database'

/** Read-only snapshot passed into the reducer at drop time. */
export interface KanbanSnapshot {
  rows: DatabaseRow[]
  groupColumn: DatabaseColumnSchema
  /** Ordered list of lane option values (UNCATEGORIZED excluded). */
  laneOptions: string[]
}

/** Derived render model: one lane per option + trailing UNCATEGORIZED lane. */
export interface KanbanLane {
  key: string
  label: string
  rows: DatabaseRow[]
}

/** Output of applyKanbanDrop. null = no-op (dropped outside / same position). */
export interface KanbanDropOutcome {
  /** Full rows array with updated sortOrder (and updated yamlData for the moved card). */
  nextRows: DatabaseRow[]
  /** IPC payload ready to send to the main process. */
  payload: DatabaseApplyKanbanDropRequest
}
