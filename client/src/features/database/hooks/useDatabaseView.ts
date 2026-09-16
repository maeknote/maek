import { databaseApi } from '@renderer/features/database/api'
// useDatabaseView - Loads meta + rows for a database folder and exposes mutations.
//
// Flow:
//   1. Resolve the DatabaseMeta by matching the folder path against workspaceStore.databases
//   2. On mount (and when the meta changes), trigger `database:sync` which reconciles
//      the SQLite index against the disk state (mtime comparison) and returns fresh rows
//   3. Expose mutation helpers that write to the markdown file first, then refresh

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DatabaseColumnSchema, DatabaseMeta, DatabaseRow } from '@shared/database'
import { useWorkspaceStore } from '@renderer/features/database/workspaceStore'

interface DatabaseViewState {
  meta: DatabaseMeta | null
  rows: DatabaseRow[]
  isLoading: boolean
  error: string | null
}

interface DatabaseViewApi extends DatabaseViewState {
  reload: () => Promise<void>
  /** Returns the newly created row on success so callers can track its id. */
  addRow: (initialValues?: Record<string, unknown>) => Promise<DatabaseRow | null>
  /** Insert a row above or below a reference row. */
  insertRow: (referenceRowId: string, position: 'above' | 'below') => Promise<DatabaseRow | null>
  deleteRow: (rowId: string) => Promise<void>
  updateCell: (rowId: string, columnName: string, value: unknown) => Promise<void>
  updateSchema: (schema: DatabaseColumnSchema[]) => Promise<void>
  /** Rename a row's file (title edit). Returns true on success. */
  renameRow: (rowId: string, newTitle: string) => Promise<boolean>
  /** Bulk-reorder rows by id (drag-and-drop). */
  reorderRows: (orderedRowIds: string[]) => Promise<void>
  /** Replace local rows with an authoritative snapshot (used after atomic drops). */
  applyAuthoritativeRows: (rows: DatabaseRow[]) => void
  /** Ignore onDatabaseRowsChanged refetches until resumeWatcher() is called. */
  suspendWatcher: () => void
  resumeWatcher: () => void
}

/** Convert an absolute folder path to the workspace-relative form stored in SQLite. */
function toRelativeFolderPath(rootPath: string, absolutePath: string): string {
  if (absolutePath === rootPath) return ''
  if (absolutePath.startsWith(`${rootPath}/`)) {
    return absolutePath.slice(rootPath.length + 1)
  }
  return absolutePath
}

/** Refresh the workspace database registry (keeps the explorer + other views in sync). */
async function refreshRegistry(rootPath: string): Promise<DatabaseMeta[]> {
  const result = await databaseApi.databaseGetAll(rootPath)
  if (result.success) {
    useWorkspaceStore.getState().setDatabases(result.databases)
    return result.databases
  }
  return []
}

export function useDatabaseView(databaseFolderPath: string): DatabaseViewApi {
  const rootPath = useWorkspaceStore((s) => s.rootPath)
  const registeredDatabases = useWorkspaceStore((s) => s.databases)

  // Locate the meta record matching this folder path.
  const meta = useMemo<DatabaseMeta | null>(() => {
    if (!rootPath) return null
    const relative = toRelativeFolderPath(rootPath, databaseFolderPath)
    return registeredDatabases.find((d) => d.folderPath === relative) ?? null
  }, [rootPath, databaseFolderPath, registeredDatabases])

  const [rows, setRows] = useState<DatabaseRow[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Gate for onDatabaseRowsChanged — set to true during active kanban drag so
  // watcher-triggered refetches don't clobber optimistic local state.
  const watcherSuspendedRef = useRef(false)

  const reload = useCallback(async () => {
    if (!rootPath || !meta) return
    setIsLoading(true)
    setError(null)
    try {
      const syncResult = await databaseApi.databaseSync(rootPath, meta.id)
      if (syncResult.success) {
        setRows(syncResult.rows)
      } else {
        setError(syncResult.error)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load database rows')
    } finally {
      setIsLoading(false)
    }
  }, [rootPath, meta])

  // Initial load + reload when the target database changes.
  useEffect(() => {
    if (!meta || !rootPath) {
      setRows([])
      return
    }
    if (!watcherSuspendedRef.current) void reload()
  }, [meta, rootPath, reload])

  // Auto-refresh when the file watcher bridge reports that this database's rows
  // have been re-indexed by the main process (external edits, file adds/deletes, etc.).
  useEffect(() => {
    if (!meta || !rootPath) return
    const unsubscribe = databaseApi.onDatabaseRowsChanged((payload) => {
      if (payload.workspacePath !== rootPath || payload.databaseId !== meta.id) return
      if (watcherSuspendedRef.current) return
      void databaseApi.databaseGetRows(rootPath, meta.id).then((result) => {
        if (result.success) setRows(result.rows)
      })
    })
    return unsubscribe
  }, [meta, rootPath])

  const addRow = useCallback(
    async (initialValues?: Record<string, unknown>): Promise<DatabaseRow | null> => {
      if (!rootPath || !meta) return null
      const result = await databaseApi.databaseAddRow(rootPath, meta.id, initialValues)
      if (!result.success) {
        setError(result.error)
        return null
      }
      await reload()
      return result.row
    },
    [rootPath, meta, reload]
  )

  const insertRow = useCallback(
    async (referenceRowId: string, position: 'above' | 'below'): Promise<DatabaseRow | null> => {
      if (!rootPath || !meta) return null
      const result = await databaseApi.databaseInsertRow(rootPath, meta.id, referenceRowId, position)
      if (!result.success) {
        setError(result.error)
        return null
      }
      await reload()
      return result.row
    },
    [rootPath, meta, reload]
  )

  const deleteRow = useCallback(
    async (rowId: string) => {
      if (!rootPath || !meta) return
      const result = await databaseApi.databaseDeleteRow(rootPath, meta.id, rowId)
      if (!result.success) {
        setError(result.error)
        return
      }
      await reload()
    },
    [rootPath, meta, reload]
  )

  const updateCell = useCallback(
    async (rowId: string, columnName: string, value: unknown) => {
      if (!rootPath || !meta) return
      const result = await databaseApi.databaseUpdateCell(
        rootPath,
        meta.id,
        rowId,
        columnName,
        value
      )
      if (!result.success) {
        setError(result.error)
        return
      }
      // Optimistic merge to avoid a full reload flicker.
      setRows((prev) => prev.map((r) => (r.id === result.row.id ? result.row : r)))
    },
    [rootPath, meta]
  )

  const updateSchema = useCallback(
    async (schema: DatabaseColumnSchema[]) => {
      if (!rootPath || !meta) return
      const result = await databaseApi.databaseUpdateSchema(rootPath, meta.id, schema)
      if (!result.success) {
        setError(result.error)
        return
      }
      await refreshRegistry(rootPath)
    },
    [rootPath, meta]
  )

  const renameRow = useCallback(
    async (rowId: string, newTitle: string): Promise<boolean> => {
      if (!rootPath || !meta) return false
      const result = await databaseApi.databaseRenameRow(rootPath, meta.id, rowId, newTitle)
      if (!result.success) {
        setError(result.error)
        return false
      }
      await reload()
      return true
    },
    [rootPath, meta, reload]
  )

  const reorderRows = useCallback(
    async (orderedRowIds: string[]): Promise<void> => {
      if (!rootPath || !meta) return
      // Optimistic local reorder to avoid flicker. Merge hidden rows back.
      setRows((prev) => {
        const byId = new Map(prev.map((r) => [r.id, r]))
        const orderedSet = new Set(orderedRowIds)
        const reordered = orderedRowIds.map((id) => byId.get(id)).filter(Boolean) as DatabaseRow[]
        const hidden = prev.filter((r) => !orderedSet.has(r.id))
        return [...reordered, ...hidden]
      })
      const result = await databaseApi.databaseReorderRows(rootPath, meta.id, orderedRowIds)
      if (!result.success) {
        setError(result.error)
        await reload()
      }
    },
    [rootPath, meta, reload]
  )

  const applyAuthoritativeRows = useCallback((authoritative: DatabaseRow[]): void => {
    setRows(authoritative)
  }, [])

  const suspendWatcher = useCallback((): void => {
    watcherSuspendedRef.current = true
  }, [])

  const resumeWatcher = useCallback((): void => {
    watcherSuspendedRef.current = false
    void reload()
  }, [reload])

  return {
    meta,
    rows,
    isLoading,
    error,
    reload,
    addRow,
    insertRow,
    deleteRow,
    updateCell,
    updateSchema,
    renameRow,
    reorderRows,
    applyAuthoritativeRows,
    suspendWatcher,
    resumeWatcher
  }
}
