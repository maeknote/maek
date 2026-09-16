import { databaseApi } from '@renderer/features/database/api'
// useKanbanBoard — glue between @hello-pangea/dnd events and the store/IPC layer.
//
// Responsibilities:
//   - Track drag lifecycle via watcher suspend/resume (prevents file-watcher
//     refetches from clobbering the optimistic state mid-commit).
//   - Run the pure reducer on drop, apply optimistic local state, fire the
//     single atomic IPC, and reconcile with the authoritative response.
//   - On failure, reload from main to recover ground truth.
//
// Nothing in this hook touches React state during drag — only at drag end.

import { useCallback } from 'react'
import type { DropResult, OnDragStartResponder } from '@hello-pangea/dnd'
import type { DatabaseColumnSchema, DatabaseRow } from '@shared/database'
import { useWorkspaceStore } from '@renderer/features/database/workspaceStore'
import { applyKanbanDrop } from './applyKanbanDrop'
import type { KanbanSnapshot } from './types'

interface UseKanbanBoardArgs {
  workspacePath: string
  databaseId: string
  groupColumn: DatabaseColumnSchema
  rows: DatabaseRow[]
  laneOptions: string[]
  applyAuthoritativeRows: (rows: DatabaseRow[]) => void
  suspendWatcher: () => void
  resumeWatcher: () => void
  reload: () => Promise<void>
}

interface UseKanbanBoardApi {
  onDragStart: OnDragStartResponder
  onDragEnd: (result: DropResult) => void
}

export function useKanbanBoard({
  workspacePath,
  databaseId,
  groupColumn,
  rows,
  laneOptions,
  applyAuthoritativeRows,
  suspendWatcher,
  resumeWatcher,
  reload
}: UseKanbanBoardArgs): UseKanbanBoardApi {
  const onDragStart: OnDragStartResponder = useCallback(() => {
    suspendWatcher()
  }, [suspendWatcher])

  const onDragEnd = useCallback(
    (result: DropResult) => {
      // Snapshot captured from the latest props — stable because onDragEnd fires
      // only after React has rendered with the current state.
      const snapshot: KanbanSnapshot = { rows, groupColumn, laneOptions }
      const outcome = applyKanbanDrop(snapshot, result, { workspacePath, databaseId })

      if (!outcome) {
        resumeWatcher()
        return
      }

      // Defer the React state update to the next frame so @hello-pangea/dnd
      // finishes its internal DOM cleanup (clearing inline transforms on
      // source + destination siblings) BEFORE our re-render replaces the
      // affected nodes. Without this defer, the cleanup can race with React
      // reconciliation and leave stale transforms on cards — which visually
      // appears as a permanent sideways shift frozen at the drop position.
      requestAnimationFrame(() => {
        applyAuthoritativeRows(outcome.nextRows)

        void (async () => {
          try {
            const res = await databaseApi.databaseApplyKanbanDrop(outcome.payload)
            if (res.success) {
              applyAuthoritativeRows(res.rows)
              const store = useWorkspaceStore.getState()
              store.setDatabases(
                store.databases.map((d) => (d.id === databaseId ? res.database : d))
              )
            } else {
              console.error('[kanban] apply drop failed:', res.error)
              await reload()
            }
          } catch (err) {
            console.error('[kanban] apply drop threw:', err)
            await reload()
          } finally {
            resumeWatcher()
          }
        })()
      })
    },
    [
      rows,
      groupColumn,
      laneOptions,
      workspacePath,
      databaseId,
      applyAuthoritativeRows,
      resumeWatcher,
      reload
    ]
  )

  return { onDragStart, onDragEnd }
}
