import { databaseApi } from '@renderer/features/database/api'
// Views share one server snapshot for each workspace/database.

import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@renderer/shared/query-client'
import { useStore } from '@renderer/features/workspace'
import { databaseRowsKey, suspendDatabaseRows, resumeDatabaseRows } from '../rowsQuery'
import type { DatabaseColumnSchema, DatabaseMeta, DatabaseRow } from '@shared/database'
import { useWorkspaceStore } from '@renderer/features/database/workspaceStore'

interface DatabaseViewState {
  meta: DatabaseMeta | null
  rows: DatabaseRow[]
  isLoading: boolean
  /** The current database has completed at least one successful row load, even if empty. */
  hasLoadedRows: boolean
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
  /** Ignore file-watcher refetches until resumeWatcher() is called. */
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

  const workspace = useStore((state) => state.workspace)
  const databaseId = meta?.id
  const workspaceId = workspace?.wsId
  const [mutationError, setError] = useState<string | null>(null)
  const queryKey = databaseRowsKey(workspaceId ?? '', databaseId ?? '')
  const query = useQuery({
    queryKey,
    enabled: Boolean(workspaceId && databaseId),
    staleTime: Infinity,
    queryFn: async () => {
      const result = await databaseApi.databaseSync(rootPath!, databaseId!)
      if (!result.success) throw new Error(result.error)
      return result.rows
    },
  })
  const rows = query.data ?? []
  const isLoading = query.isFetching
  const error = mutationError ?? (query.error instanceof Error ? query.error.message : null)
  const setRows = useCallback((next: DatabaseRow[] | ((previous: DatabaseRow[]) => DatabaseRow[])) => {
    if (!workspaceId || !databaseId) return
    queryClient.setQueryData<DatabaseRow[]>(databaseRowsKey(workspaceId, databaseId), previous =>
      typeof next === 'function' ? next(previous ?? []) : next)
  }, [workspaceId, databaseId])
  const reload = useCallback(async () => {
    if (!workspaceId || !databaseId) return
    setError(null)
    await queryClient.invalidateQueries({ queryKey: databaseRowsKey(workspaceId, databaseId) })
  }, [workspaceId, databaseId])

  const addRow = useCallback(
    async (initialValues?: Record<string, unknown>): Promise<DatabaseRow | null> => {
      if (!rootPath || !meta) return null
      const result = await databaseApi.databaseAddRow(rootPath, meta.id, initialValues)
      if (!result.success) {
        setError(result.error)
        return null
      }
      return result.row
    },
    [rootPath, meta]
  )

  const insertRow = useCallback(
    async (referenceRowId: string, position: 'above' | 'below'): Promise<DatabaseRow | null> => {
      if (!rootPath || !meta) return null
      const result = await databaseApi.databaseInsertRow(rootPath, meta.id, referenceRowId, position)
      if (!result.success) {
        setError(result.error)
        return null
      }
      return result.row
    },
    [rootPath, meta]
  )

  const deleteRow = useCallback(
    async (rowId: string) => {
      if (!rootPath || !meta) return
      const result = await databaseApi.databaseDeleteRow(rootPath, meta.id, rowId)
      if (!result.success) {
        setError(result.error)
        return
      }
    },
    [rootPath, meta]
  )

  const updateCell = useCallback(
    async (rowId: string, columnName: string, value: unknown) => {
      if (!rootPath || !meta) throw new Error('Database is not ready')
      setError(null)
      const result = await databaseApi.databaseUpdateCell(
        rootPath,
        meta.id,
        rowId,
        columnName,
        value
      )
      if (!result.success) {
        setError(result.error)
        throw new Error(result.error)
      }
      // Optimistic merge to avoid a full reload flicker.
      setRows((prev) => prev.map((r) => (r.id === result.row.id ? result.row : r)))
      setError(null)
    },
    [rootPath, meta, setRows]
  )

  const updateSchema = useCallback(
    async (schema: DatabaseColumnSchema[]) => {
      if (!rootPath || !meta) throw new Error('Database is not ready')
      setError(null)
      const result = await databaseApi.databaseUpdateSchema(rootPath, meta.id, schema)
      if (!result.success) {
        setError(result.error)
        throw new Error(result.error)
      }
      const refreshed = await refreshRegistry(rootPath)
      if (!refreshed.length) throw new Error('Could not refresh database settings')
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
      return true
    },
    [rootPath, meta]
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
    [rootPath, meta, reload, setRows]
  )

  const applyAuthoritativeRows = useCallback((authoritative: DatabaseRow[]): void => {
    setRows(authoritative)
  }, [setRows])

  const suspendWatcher = useCallback((): void => {
    if (workspaceId && databaseId) suspendDatabaseRows(workspaceId, databaseId)
  }, [workspaceId, databaseId])
  const resumeWatcher = useCallback((): void => {
    if (workspaceId && databaseId) resumeDatabaseRows(workspaceId, databaseId)
  }, [workspaceId, databaseId])

  return {
    meta,
    rows,
    isLoading,
    hasLoadedRows: query.data !== undefined,
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
