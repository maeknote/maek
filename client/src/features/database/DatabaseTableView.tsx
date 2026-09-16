import { databaseApi } from '@renderer/features/database/api'
// DatabaseTableView - General-purpose table view for a database folder.
//
// Layout contract:
//   - Top: a lightweight status strip (row count + loading/error)
//   - Middle: the table grid
//     · Leading sticky column: row hover handle (delete button)
//     · Column headers open an inline dropdown for editing
//     · Trailing "+" header adds a new column at the end
//     · Data cells are inline-editable
//   - Bottom (tfoot): per-column aggregations + a "+ New row" full-width button
//
// The database name is rendered/edited by the editor's TitleBar above this
// component, so this view only owns the table and its immediate affordances.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactElement,
  type MouseEvent
} from 'react'
import { ArrowDown, ArrowUp, ChevronDown, Filter, Loader2, Plus } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type {
  DatabaseAggregation,
  DatabaseColumnSchema,
  DatabaseColumnType,
  DatabaseFilterCondition,
  DatabaseSortRule,
  DatabaseViewState,
  NumberFormat,
  SortDirection,
  TableViewConfig
} from '@shared/database'
import type { FloatingMenuPosition } from '@renderer/shared/components'
import { useDatabaseView } from './hooks/useDatabaseView'
import { Cell } from './components/Cell'
import { ColumnHeaderMenu } from './components/ColumnHeaderMenu'
import { RowHandleMenu } from './components/RowHandleMenu'
import { TitleCellToolbar } from './components/TitleCellToolbar'
import { NotePopupModal } from './components/NotePopupModal'
import { ViewFilterSortToolbar } from './components/ViewFilterSortToolbar'
import { useWorkspaceStore } from '@renderer/features/database/workspaceStore'
import { computeAggregation, getAggregationOptions } from './utils/aggregation'
import { applyFilter } from './utils/filterEvaluator'
import { deriveDefaultsFromFilter } from './utils/filterDefaults'
import { applySort, TITLE_SORT_COLUMN_ID } from './utils/rowSort'
import { databaseRowFilePath } from './utils/rowFilePath'
import { isOperatorAllowed } from './utils/filterOperators'
import { mergeTableViewConfig, resolveColumnOrder } from './tableViewConfig'

interface DatabaseTableViewProps {
  /** Absolute path of the database folder (doubles as the tab id). */
  databaseFolderPath: string
}

const TYPE_BADGE: Record<DatabaseColumnType, string> = {
  text: 'Aa',
  number: '#',
  boolean: '☑',
  date: '📅',
  'date-range': '↔',
  select: '⌄',
  'multi-select': '⌄⌄',
  list: '≡'
}

export function DatabaseTableView({ databaseFolderPath }: DatabaseTableViewProps): ReactElement {
  const {
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
    reorderRows
  } = useDatabaseView(databaseFolderPath)

  const rootPath = useWorkspaceStore((s) => s.rootPath)
  const dbEntry = useWorkspaceStore((s) =>
    meta ? s.databases.find((d) => d.id === meta.id) : undefined
  )
  const tableConfig = useMemo<TableViewConfig | null>(() => {
    if (!dbEntry?.viewConfig) return null
    return dbEntry.viewConfig.type === 'table' ? dbEntry.viewConfig.config : null
  }, [dbEntry])

  // Column header dropdown state: which column is open, and where to anchor the menu.
  const [openColumnId, setOpenColumnId] = useState<string | null>(null)
  const [menuPosition, setMenuPosition] = useState<FloatingMenuPosition | null>(null)
  // Refs to column header buttons so the FloatingMenu positioning ignores outside-click
  // on the anchor itself.
  const columnButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  // Optimistic override for column order during a drag drop. Holds the
  // just-dropped id sequence until the store catches up with the persisted
  // value, so the column doesn't visually snap back to the old order during
  // the IPC round-trip.
  const [optimisticColumnOrder, setOptimisticColumnOrder] = useState<string[] | null>(null)
  const effectiveColumnOrder = optimisticColumnOrder ?? tableConfig?.columnOrder

  const columns = useMemo(() => {
    if (!meta) return []
    return resolveColumnOrder(meta.schema, effectiveColumnOrder)
  }, [meta, effectiveColumnOrder])

  // Clear the optimistic override once the authoritative config matches it.
  // We compare element-wise because the store always hands back fresh array
  // references even when contents are identical.
  useEffect(() => {
    if (!optimisticColumnOrder) return
    const stored = tableConfig?.columnOrder
    if (!stored || stored.length !== optimisticColumnOrder.length) return
    for (let i = 0; i < stored.length; i++) {
      if (stored[i] !== optimisticColumnOrder[i]) return
    }
    setOptimisticColumnOrder(null)
  }, [tableConfig?.columnOrder, optimisticColumnOrder])

  // --- Sort + filter view state, persisted into TableViewConfig ---
  //
  // Local React state drives the rendering pipeline so typing into a filter
  // input stays snappy; writes to SQLite flow through `persistTableConfig`
  // (sort — immediate; filter — debounced).
  const [viewState, setViewState] = useState<DatabaseViewState>(() => {
    const snap = useWorkspaceStore
      .getState()
      .databases.find((d) => d.folderPath === meta?.folderPath)?.viewConfig
    const init = snap?.type === 'table' ? snap.config : null
    return {
      sort: init?.sort ?? [],
      filter: init?.filter ?? { combinator: 'and', conditions: [] }
    }
  })

  // Re-hydrate from the persisted config when switching databases so each
  // database's last sort/filter state is restored.
  //
  // `hydratedForId` is STATE (not a ref). setViewState and setHydratedForId
  // are batched together, so the persist effects below only observe
  // `hydratedForId === meta.id` on the render AFTER viewState is already
  // the hydrated value. Using a ref here would let persist fire in the same
  // commit as hydration with viewState still pre-hydration → empty sort /
  // filter would be written back to SQLite, clobbering persisted data.
  const [hydratedForId, setHydratedForId] = useState<string | null>(null)
  useEffect(() => {
    if (!meta) return
    if (hydratedForId === meta.id) return
    setViewState({
      sort: tableConfig?.sort ?? [],
      filter: tableConfig?.filter ?? { combinator: 'and', conditions: [] }
    })
    setHydratedForId(meta.id)
  }, [meta, tableConfig, hydratedForId])

  // CRITICAL: persistTableConfig is stabilized via a ref for the database id
  // so its identity does NOT change every time the store updates. If it did,
  // the sort/filter persist effects below would feed back into themselves —
  // each persist triggers setDatabases → new meta ref → new persistTableConfig
  // identity → effect re-fires → infinite write loop.
  const databaseIdRef = useRef<string | null>(null)
  useEffect(() => {
    databaseIdRef.current = meta?.id ?? null
  }, [meta?.id])

  const persistTableConfig = useCallback(
    async (patch: Partial<TableViewConfig>): Promise<void> => {
      const databaseId = databaseIdRef.current
      if (!rootPath || !databaseId) return
      const live = useWorkspaceStore.getState().databases.find((d) => d.id === databaseId)
      const activeViewId = live?.activeViewId
      if (!activeViewId) return
      const liveConfig: TableViewConfig | undefined =
        live?.viewConfig?.type === 'table' ? live.viewConfig.config : undefined
      const nextConfig = mergeTableViewConfig(liveConfig, patch)
      const result = await databaseApi.databaseUpdateView(rootPath, databaseId, activeViewId, {
        config: nextConfig
      })
      if (result.success) {
        useWorkspaceStore
          .getState()
          .setDatabases(
            useWorkspaceStore
              .getState()
              .databases.map((d) => (d.id === databaseId ? result.database : d))
          )
      }
    },
    [rootPath]
  )

  // Sort persists immediately — low-frequency action. Guards on `hydratedForId`
  // so we never persist pre-hydration viewState to SQLite.
  useEffect(() => {
    const id = meta?.id
    if (!id || hydratedForId !== id) return
    void persistTableConfig({ sort: viewState.sort })
  }, [viewState.sort, hydratedForId, meta?.id, persistTableConfig])

  // Filter persists with a short debounce so typing into a condition value
  // doesn't spam SQLite writes.
  useEffect(() => {
    const id = meta?.id
    if (!id || hydratedForId !== id) return
    const handle = setTimeout(() => {
      void persistTableConfig({ filter: viewState.filter })
    }, 300)
    return () => clearTimeout(handle)
  }, [viewState.filter, hydratedForId, meta?.id, persistTableConfig])

  const filteredRows = useMemo(() => {
    return applyFilter(rows, columns, viewState.filter)
  }, [rows, columns, viewState.filter])

  const visibleRows = useMemo(
    () => applySort(filteredRows, columns, viewState.sort),
    [filteredRows, columns, viewState.sort]
  )

  // Fast lookup helpers so the header icons and ColumnHeaderMenu don't need
  // to re-scan the viewState arrays on every render.
  const sortByColumnId = useMemo(() => {
    const map = new Map<string, SortDirection>()
    for (const rule of viewState.sort) map.set(rule.columnId, rule.direction)
    return map
  }, [viewState.sort])

  const filterByColumnId = useMemo(() => {
    const map = new Map<string, DatabaseFilterCondition>()
    for (const cond of viewState.filter.conditions) map.set(cond.columnId, cond)
    return map
  }, [viewState.filter.conditions])

  // --- viewState mutators ---

  /**
   * Multi-rule sort: if the column already has a rule, update its direction
   * in place (preserves its priority position); otherwise append a new one.
   * `direction === null` removes the rule.
   */
  const setSortForColumn = useCallback(
    (columnId: string, direction: SortDirection | null): void => {
      setViewState((prev) => {
        if (direction === null) {
          return { ...prev, sort: prev.sort.filter((r) => r.columnId !== columnId) }
        }
        const exists = prev.sort.some((r) => r.columnId === columnId)
        const next = exists
          ? prev.sort.map((r) => (r.columnId === columnId ? { ...r, direction } : r))
          : [...prev.sort, { columnId, direction }]
        return { ...prev, sort: next }
      })
    },
    []
  )
  // Replace the entire sort array — used by the sort menu's drag-to-reorder.
  const reorderSortRules = useCallback((rules: DatabaseSortRule[]): void => {
    setViewState((prev) => ({ ...prev, sort: rules }))
  }, [])

  const setFilterForColumn = useCallback((next: DatabaseFilterCondition): void => {
    setViewState((prev) => {
      const without = prev.filter.conditions.filter((c) => c.columnId !== next.columnId)
      return {
        ...prev,
        filter: { ...prev.filter, conditions: [...without, next] }
      }
    })
  }, [])

  const clearFilterForColumn = useCallback((columnId: string): void => {
    setViewState((prev) => ({
      ...prev,
      filter: {
        ...prev.filter,
        conditions: prev.filter.conditions.filter((c) => c.columnId !== columnId)
      }
    }))
  }, [])

  const clearAllViewState = useCallback((): void => {
    setViewState({ sort: [], filter: { combinator: 'and', conditions: [] } })
  }, [])

  /**
   * Add a new row, pre-populating columns with values that satisfy the
   * active filter so the row stays visible without an out-of-band whitelist.
   *
   * Declared before the early return so the hook order stays stable
   * between the loading and loaded branches.
   */
  const handleAddRow = useCallback(async (): Promise<void> => {
    const initialValues = deriveDefaultsFromFilter(viewState.filter, columns)
    await addRow(Object.keys(initialValues).length > 0 ? initialValues : undefined)
  }, [addRow, viewState.filter, columns])

  const handleInsertRow = useCallback(
    async (referenceRowId: string, position: 'above' | 'below'): Promise<void> => {
      // The IPC for `insertRow` doesn't accept initial values, so we patch
      // the new row's filter-derived cells in a follow-up sequence. Each
      // `updateCell` does an optimistic merge, so the row settles into the
      // visible set as soon as the last cell satisfying the filter is set.
      const newRow = await insertRow(referenceRowId, position)
      if (!newRow) return
      const initialValues = deriveDefaultsFromFilter(viewState.filter, columns)
      for (const [columnName, value] of Object.entries(initialValues)) {
        await updateCell(newRow.id, columnName, value)
      }
    },
    [insertRow, updateCell, viewState.filter, columns]
  )

  // --- Drag-and-drop row reorder state ---
  const [dragRowId, setDragRowId] = useState<string | null>(null)
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null)
  const hasSortActive = viewState.sort.length > 0
  const hasFilterActive = viewState.filter.conditions.length > 0
  const isDragDisabled = hasSortActive || hasFilterActive

  const handleRowDragStart = useCallback(
    (rowId: string) => (e: DragEvent<HTMLButtonElement>) => {
      if (isDragDisabled) {
        e.preventDefault()
        return
      }
      setDragRowId(rowId)
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', rowId)
    },
    [isDragDisabled]
  )

  const handleRowDragOver = useCallback(
    (idx: number) => (e: DragEvent<HTMLTableRowElement>) => {
      if (!dragRowId) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      // Determine whether the drop indicator goes above or below this row.
      const rect = e.currentTarget.getBoundingClientRect()
      const midY = rect.top + rect.height / 2
      const targetIdx = e.clientY < midY ? idx : idx + 1
      setDropTargetIdx(targetIdx)
    },
    [dragRowId]
  )

  const handleRowDrop = useCallback(
    (e: DragEvent<HTMLTableRowElement>) => {
      e.preventDefault()
      if (!dragRowId || dropTargetIdx === null) return
      const currentIdx = visibleRows.findIndex((r) => r.id === dragRowId)
      if (currentIdx === -1) return
      // Build the new order from all rows (visible reordered + hidden appended).
      const visibleIds = visibleRows.map((r) => r.id)
      visibleIds.splice(currentIdx, 1)
      const insertIdx = dropTargetIdx > currentIdx ? dropTargetIdx - 1 : dropTargetIdx
      visibleIds.splice(insertIdx, 0, dragRowId)
      // Append hidden rows (filtered out) at the end to preserve their relative order.
      const visibleSet = new Set(visibleIds)
      const hiddenIds = rows.filter((r) => !visibleSet.has(r.id)).map((r) => r.id)
      void reorderRows([...visibleIds, ...hiddenIds])
      setDragRowId(null)
      setDropTargetIdx(null)
    },
    [dragRowId, dropTargetIdx, visibleRows, rows, reorderRows]
  )

  const handleRowDragEnd = useCallback(() => {
    setDragRowId(null)
    setDropTargetIdx(null)
  }, [])

  // --- Column header drag-to-reorder ---
  //
  // Persists a `columnOrder` list on TableViewConfig so reordering does not
  // mutate `DatabaseColumnSchema.order` — other views (kanban card previews,
  // etc.) keep seeing the schema's canonical order.
  const [dragColumnId, setDragColumnId] = useState<string | null>(null)
  const [colDropTargetIdx, setColDropTargetIdx] = useState<number | null>(null)

  const handleColumnDragStart = useCallback(
    (columnId: string) => (e: DragEvent<HTMLElement>) => {
      setDragColumnId(columnId)
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', columnId)
    },
    []
  )

  const handleColumnDragOver = useCallback(
    (idx: number) => (e: DragEvent<HTMLTableCellElement>) => {
      if (!dragColumnId) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const rect = e.currentTarget.getBoundingClientRect()
      const midX = rect.left + rect.width / 2
      const targetIdx = e.clientX < midX ? idx : idx + 1
      setColDropTargetIdx(targetIdx)
    },
    [dragColumnId]
  )

  const handleColumnDrop = useCallback(
    (e: DragEvent<HTMLTableCellElement>) => {
      e.preventDefault()
      if (!dragColumnId || colDropTargetIdx === null) return
      const currentIdx = columns.findIndex((c) => c.id === dragColumnId)
      if (currentIdx === -1) {
        setDragColumnId(null)
        setColDropTargetIdx(null)
        return
      }
      const ids = columns.map((c) => c.id)
      ids.splice(currentIdx, 1)
      const insertIdx = colDropTargetIdx > currentIdx ? colDropTargetIdx - 1 : colDropTargetIdx
      ids.splice(insertIdx, 0, dragColumnId)
      setDragColumnId(null)
      setColDropTargetIdx(null)
      if (ids.length > 0) {
        // Paint the new order immediately; the effect clears the override
        // once the authoritative config matches.
        setOptimisticColumnOrder(ids)
        void persistTableConfig({ columnOrder: ids })
      }
    },
    [dragColumnId, colDropTargetIdx, columns, persistTableConfig]
  )

  const handleColumnDragEnd = useCallback(() => {
    setDragColumnId(null)
    setColDropTargetIdx(null)
  }, [])

  // --- Title cell edit (rename row file) ---
  const [editingTitleRowId, setEditingTitleRowId] = useState<string | null>(null)
  const [titleDraft, setTitleDraft] = useState('')

  const startTitleEdit = useCallback((rowId: string, currentFileName: string) => {
    setEditingTitleRowId(rowId)
    setTitleDraft(currentFileName.replace(/\.md$/i, ''))
  }, [])

  const commitTitleEdit = useCallback(async () => {
    if (!editingTitleRowId) return
    const rowId = editingTitleRowId
    // Clear editing state immediately to prevent double-fire from Enter + blur.
    setEditingTitleRowId(null)
    setTitleDraft('')
    // Let the backend sanitize empty titles (falls back to 'Untitled').
    await renameRow(rowId, titleDraft.trim() || 'Untitled')
  }, [editingTitleRowId, titleDraft, renameRow])

  // --- Note popup state ---
  const [popupFilePath, setPopupFilePath] = useState<string | null>(null)

  const openRowAsPage = useCallback(
    (rowFileName: string) => {
      const filePath = databaseRowFilePath(databaseFolderPath, rowFileName)
      const parentName = databaseFolderPath.split('/').pop() ?? ''
      useWorkspaceStore.getState().setFileOpenIntent({
        fileId: filePath,
        fileName: rowFileName,
        parentName,
        mode: 'pin',
        kind: 'file'
      })
    },
    [databaseFolderPath]
  )

  const openRowInPopup = useCallback(
    (rowFileName: string) => {
      setPopupFilePath(databaseRowFilePath(databaseFolderPath, rowFileName))
    },
    [databaseFolderPath]
  )

  const closePopup = useCallback(() => {
    setPopupFilePath(null)
  }, [])

  const handlePopupRename = useCallback(
    async (newFileName: string): Promise<void> => {
      if (!rootPath || !meta || !popupFilePath) throw new Error('Workspace not ready')
      const currentFileName = popupFilePath.slice(databaseFolderPath.length + 1)
      const currentRow = rows.find((r) => r.fileName === currentFileName)
      if (!currentRow) throw new Error('Row not found for popup')
      const newTitle = newFileName.replace(/\.md$/i, '')
      const result = await databaseApi.databaseRenameRow(rootPath, meta.id, currentRow.id, newTitle)
      if (!result.success) throw new Error(result.error)
      setPopupFilePath(databaseRowFilePath(databaseFolderPath, result.row.fileName))
      await reload()
    },
    [rootPath, meta, rows, popupFilePath, databaseFolderPath, reload]
  )

  if (!meta) {
    return (
      <div className="h-full flex items-center justify-center text-muted-text text-sm">
        {isLoading ? (
          <span className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading database…
          </span>
        ) : (
          'This folder is not registered as a database.'
        )}
      </div>
    )
  }

  const handleCellCommit =
    (rowId: string, columnName: string) =>
    (value: unknown): void => {
      void updateCell(rowId, columnName, value)
    }

  const handleAggregationChange = async (
    column: DatabaseColumnSchema,
    aggregation: DatabaseAggregation
  ): Promise<void> => {
    const nextSchema = columns.map((c) => (c.id === column.id ? { ...c, aggregation } : c))
    await updateSchema(nextSchema)
  }

  const openColumnMenu = (event: MouseEvent<HTMLElement>, columnId: string): void => {
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    setMenuPosition({ x: rect.left, y: rect.bottom })
    setOpenColumnId(columnId)
  }

  const closeColumnMenu = (): void => {
    setOpenColumnId(null)
    setMenuPosition(null)
  }

  const handleColumnRename = async (columnId: string, newName: string): Promise<void> => {
    const nextSchema = columns.map((c) => (c.id === columnId ? { ...c, name: newName } : c))
    await updateSchema(nextSchema)
  }

  const handleColumnTypeChange = async (
    columnId: string,
    newType: DatabaseColumnType
  ): Promise<void> => {
    const nextSchema = columns.map((c) => {
      if (c.id !== columnId) return c
      const next: DatabaseColumnSchema = { ...c, type: newType }
      // Clean up fields that no longer apply to the new type so stale config
      // doesn't linger in schema_json.
      if (newType !== 'select' && newType !== 'multi-select') delete next.options
      if (newType !== 'number') delete next.numberFormat
      // If the current aggregation is not valid for the new type, reset it.
      if (next.aggregation) {
        const validAggs = getAggregationOptions(newType).map((o) => o.value)
        if (!validAggs.includes(next.aggregation)) {
          next.aggregation = 'none'
        }
      }
      return next
    })
    await updateSchema(nextSchema)

    // Drop any filter on this column whose operator is no longer applicable
    // to the new type. Sort comparators are type-aware and stay valid, so
    // we leave sort rules alone.
    setViewState((prev) => {
      const nextConditions = prev.filter.conditions.filter((c) => {
        if (c.columnId !== columnId) return true
        return isOperatorAllowed(newType, c.operator)
      })
      if (nextConditions.length === prev.filter.conditions.length) return prev
      return { ...prev, filter: { ...prev.filter, conditions: nextConditions } }
    })
  }

  const handleColumnNumberFormatChange = async (
    columnId: string,
    format: NumberFormat
  ): Promise<void> => {
    const nextSchema = columns.map((c) => (c.id === columnId ? { ...c, numberFormat: format } : c))
    await updateSchema(nextSchema)
  }

  const handleColumnOptionsChange = async (
    columnId: string,
    nextOptions: string[]
  ): Promise<void> => {
    const nextSchema = columns.map((c) => (c.id === columnId ? { ...c, options: nextOptions } : c))
    await updateSchema(nextSchema)
  }

  /** Add a single new option to a select / multi-select column. Used by cell editors. */
  const handleAddOptionToColumn = (columnId: string, newOption: string): void => {
    const target = columns.find((c) => c.id === columnId)
    if (!target) return
    const existing = target.options ?? []
    if (existing.includes(newOption)) return
    void handleColumnOptionsChange(columnId, [...existing, newOption])
  }

  const handleColumnDelete = async (columnId: string): Promise<void> => {
    const nextSchema = columns
      .filter((c) => c.id !== columnId)
      .map((c, idx) => ({ ...c, order: idx }))
    await updateSchema(nextSchema)

    // Strip any sort/filter referring to the deleted column so the chip bar
    // and pipeline stay coherent.
    setViewState((prev) => ({
      sort: prev.sort.filter((r) => r.columnId !== columnId),
      filter: {
        ...prev.filter,
        conditions: prev.filter.conditions.filter((c) => c.columnId !== columnId)
      }
    }))
  }

  /** Pick a unique default name for a newly added column. */
  const generateColumnName = (): string => {
    const existingNames = new Set(columns.map((c) => c.name))
    let counter = columns.length + 1
    let name = `Column ${counter}`
    while (existingNames.has(name)) {
      counter += 1
      name = `Column ${counter}`
    }
    return name
  }

  const handleAddColumn = async (): Promise<void> => {
    const nextSchema: DatabaseColumnSchema[] = [
      ...columns,
      {
        id: crypto.randomUUID(),
        name: generateColumnName(),
        type: 'text',
        order: columns.length
      }
    ]
    await updateSchema(nextSchema)
  }

  /** Insert a new column adjacent to `targetColumnId`. */
  const handleInsertColumn = async (
    targetColumnId: string,
    position: 'left' | 'right'
  ): Promise<void> => {
    const targetIdx = columns.findIndex((c) => c.id === targetColumnId)
    if (targetIdx === -1) return
    const insertIdx = position === 'left' ? targetIdx : targetIdx + 1

    const newColumn: DatabaseColumnSchema = {
      id: crypto.randomUUID(),
      name: generateColumnName(),
      type: 'text',
      order: 0 // overwritten right below
    }

    const nextSchema = [...columns]
    nextSchema.splice(insertIdx, 0, newColumn)
    // Re-number `order` for all columns after the insertion to keep them dense.
    const reordered = nextSchema.map((c, idx) => ({ ...c, order: idx }))
    await updateSchema(reordered)
  }

  const activeColumn =
    openColumnId !== null ? (columns.find((c) => c.id === openColumnId) ?? null) : null

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Unified toolbar: row count on the left, active filter/sort chips in
          the middle, [Filter][Sort] buttons on the right. Matches the
          kanban/calendar/timeline layout so all views share one interaction
          pattern. */}
      <ViewFilterSortToolbar
        columns={columns}
        viewState={viewState}
        onSetFilter={setFilterForColumn}
        onClearFilter={clearFilterForColumn}
        onSetSort={setSortForColumn}
        onReorderSort={reorderSortRules}
        onClearAll={clearAllViewState}
        leading={
          filteredRows.length !== rows.length ? (
            <span>
              {visibleRows.length} of {rows.length} rows
            </span>
          ) : (
            <span>
              {rows.length} {rows.length === 1 ? 'row' : 'rows'}
            </span>
          )
        }
      />

      {error && (
        <div className="mx-6 mb-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse">
          {/*
           * Border convention: borders are attached to data cells only — never to
           * <tr> rows or to the leading handle / trailing "+" columns. This keeps
           * the sticky handle area visually empty and lets horizontal lines start
           * cleanly at the first data column.
           */}
          <thead className="sticky top-0 z-[2] bg-surface shadow-[0_4px_6px_-4px_rgba(0,0,0,0.1)] dark:shadow-[0_4px_6px_-4px_rgba(0,0,0,0.4)]">
            <tr>
              {/* Leading sticky handle cell — intentionally borderless */}
              <th className="sticky left-0 z-[3] w-8 bg-surface" aria-hidden="true" />
              {/* Fixed Title column — always first, derived from file name.
                  Sort indicator mirrors the data-column headers so a Title
                  sort rule is discoverable even though the Title column
                  has no dropdown menu. */}
              <th className="p-0 text-left border-b border-r border-[var(--glass-border)]">
                <div className="flex w-full items-center gap-1.5 px-3 py-2.5">
                  <span className="inline-flex h-4 min-w-4 items-center justify-center rounded bg-surface-overlay px-1 text-[10px] font-semibold text-muted-text">
                    Aa
                  </span>
                  <span className="truncate text-xs font-medium text-neutral-ink">Title</span>
                  {sortByColumnId.get(TITLE_SORT_COLUMN_ID) === 'asc' && (
                    <ArrowUp className="h-3 w-3 shrink-0 text-muted-text" aria-hidden="true" />
                  )}
                  {sortByColumnId.get(TITLE_SORT_COLUMN_ID) === 'desc' && (
                    <ArrowDown className="h-3 w-3 shrink-0 text-muted-text" aria-hidden="true" />
                  )}
                </div>
              </th>
              {columns.map((col, idx) => {
                const sortDir = sortByColumnId.get(col.id)
                const hasFilter = filterByColumnId.has(col.id)
                const isDragging = dragColumnId === col.id
                const showLeftIndicator = colDropTargetIdx === idx && !isDragging
                const showRightIndicator =
                  idx === columns.length - 1 && colDropTargetIdx === columns.length && !isDragging
                return (
                  <th
                    key={col.id}
                    className={cn(
                      'relative p-0 text-left border-b border-[var(--glass-border)]',
                      // Drop the right border on the rightmost data column so the
                      // table edge doesn't show a stray vertical line.
                      idx < columns.length - 1 && 'border-r',
                      isDragging && 'opacity-40'
                    )}
                    onContextMenu={(e) => openColumnMenu(e, col.id)}
                    onDragOver={handleColumnDragOver(idx)}
                    onDrop={handleColumnDrop}
                    onDragEnd={handleColumnDragEnd}
                  >
                    {showLeftIndicator && (
                      <span
                        className="pointer-events-none absolute -left-px top-1/2 -translate-y-1/2 h-[24px] w-[2px] rounded-full bg-maek-red z-[5]"
                        aria-hidden="true"
                      />
                    )}
                    {showRightIndicator && (
                      <span
                        className="pointer-events-none absolute -right-px top-1/2 -translate-y-1/2 h-[24px] w-[2px] rounded-full bg-maek-red z-[5]"
                        aria-hidden="true"
                      />
                    )}
                    <button
                      ref={(el) => {
                        if (el) columnButtonRefs.current.set(col.id, el)
                        else columnButtonRefs.current.delete(col.id)
                      }}
                      type="button"
                      draggable
                      onDragStart={handleColumnDragStart(col.id)}
                      onClick={(e) => openColumnMenu(e, col.id)}
                      className="flex w-full items-center gap-1.5 px-3 py-2.5 text-left hover:bg-surface-overlay/60 transition-colors cursor-grab active:cursor-grabbing"
                    >
                      <span className="inline-flex h-4 min-w-4 items-center justify-center rounded bg-surface-overlay px-1 text-[10px] font-semibold text-muted-text">
                        {TYPE_BADGE[col.type]}
                      </span>
                      <span className="truncate text-xs font-medium text-neutral-ink">
                        {col.name}
                      </span>
                      {/* Sort / filter indicators — shown when this column
                          participates in the current view state. */}
                      {sortDir === 'asc' && (
                        <ArrowUp className="h-3 w-3 shrink-0 text-muted-text" aria-hidden="true" />
                      )}
                      {sortDir === 'desc' && (
                        <ArrowDown
                          className="h-3 w-3 shrink-0 text-muted-text"
                          aria-hidden="true"
                        />
                      )}
                      {hasFilter && (
                        <Filter className="h-3 w-3 shrink-0 text-muted-text" aria-hidden="true" />
                      )}
                    </button>
                  </th>
                )
              })}
              {/* Trailing "+ add column" header — borderless.
                  The tooltip is anchored to the trigger's right edge so it
                  extends LEFTWARD into the table area instead of bleeding past
                  the table's right edge. A centered tooltip would extend
                  ~40px beyond the right edge, which the wrapper's
                  `overflow-auto` would treat as horizontal overflow and force
                  a scrollbar even when the table itself fits the container. */}
              <th className="p-0 w-16 min-w-16">
                <div className="group relative">
                  <button
                    type="button"
                    onClick={() => void handleAddColumn()}
                    className="flex h-full w-full items-center justify-center py-2.5 text-muted-text hover:bg-surface-overlay/60 hover:text-neutral-ink transition-colors"
                    aria-label="Add column"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  <span className="pointer-events-none absolute top-full right-0 z-10 mt-1.5 whitespace-nowrap rounded-md bg-neutral-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 dark:bg-neutral-700">
                    Add column
                  </span>
                </div>
              </th>
            </tr>
          </thead>

          <tbody>
            {columns.length === 0 && (
              <tr>
                <td colSpan={3} className="py-10 text-center text-sm text-muted-text">
                  No columns yet. Click the <Plus className="inline h-3 w-3" /> above to add one.
                </td>
              </tr>
            )}

            {columns.length > 0 && rows.length === 0 && !isLoading && (
              <tr>
                <td
                  colSpan={columns.length + 3}
                  className="py-8 text-center text-sm text-muted-text"
                >
                  No rows yet.
                </td>
              </tr>
            )}

            {columns.length > 0 && rows.length > 0 && visibleRows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + 3}
                  className="py-8 text-center text-sm text-muted-text"
                >
                  No rows match the current filter.
                </td>
              </tr>
            )}

            {visibleRows.map((row, rowIdx) => (
              <tr
                key={row.id}
                className={cn(
                  'group hover:bg-surface-overlay/40 transition-colors relative',
                  dragRowId === row.id && 'opacity-40'
                )}
                onDragOver={handleRowDragOver(rowIdx)}
                onDrop={handleRowDrop}
                onDragEnd={handleRowDragEnd}
              >
                {/* Drop indicator line */}
                {dropTargetIdx === rowIdx && dragRowId !== row.id && (
                  <td
                    colSpan={columns.length + 3}
                    className="absolute left-8 right-0 top-0 h-0.5 bg-blue-500 z-[5] pointer-events-none"
                    aria-hidden="true"
                  />
                )}
                {/* Leading row handle — borderless, sticky */}
                <td className="sticky left-0 z-[1] w-8 bg-surface align-middle group-hover:bg-surface-overlay/40">
                  <RowHandleMenu
                    onOpenAsPage={() => openRowAsPage(row.fileName)}
                    onOpenInPopup={() => openRowInPopup(row.fileName)}
                    onInsertAbove={() => void handleInsertRow(row.id, 'above')}
                    onInsertBelow={() => void handleInsertRow(row.id, 'below')}
                    onDelete={() => void deleteRow(row.id)}
                    draggable={!isDragDisabled}
                    onDragStart={handleRowDragStart(row.id)}
                  />
                </td>
                {/* Title cell — editable, derived from file name */}
                <td className="relative align-top h-9 border-b border-r border-[var(--glass-border)]/60 group/title">
                  {editingTitleRowId === row.id ? (
                    <input
                      type="text"
                      value={titleDraft}
                      onChange={(e) => setTitleDraft(e.target.value)}
                      onBlur={() => void commitTitleEdit()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void commitTitleEdit()
                        if (e.key === 'Escape') {
                          setEditingTitleRowId(null)
                          setTitleDraft('')
                        }
                      }}
                      autoFocus
                      className="h-full w-full bg-transparent px-3 py-1.5 text-sm text-neutral-ink outline-none"
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        className="h-full w-full px-3 py-1.5 text-left text-sm text-neutral-ink truncate hover:bg-surface-overlay/40"
                        onClick={() => startTitleEdit(row.id, row.fileName)}
                      >
                        {row.fileName.replace(/\.md$/i, '')}
                      </button>
                      <TitleCellToolbar
                        onOpenAsPage={() => openRowAsPage(row.fileName)}
                        onOpenInPopup={() => openRowInPopup(row.fileName)}
                      />
                    </>
                  )}
                </td>
                {columns.map((col, idx) => (
                  <td
                    key={col.id}
                    className={cn(
                      'relative align-top h-9 border-b border-[var(--glass-border)]/60',
                      idx < columns.length - 1 && 'border-r'
                    )}
                  >
                    <Cell
                      column={col}
                      value={row.yamlData[col.name]}
                      onCommit={handleCellCommit(row.id, col.name)}
                      onAddOption={(opt) => handleAddOptionToColumn(col.id, opt)}
                    />
                  </td>
                ))}
                {/* Trailing spacer cell — borderless */}
                <td className="w-16 min-w-16" aria-hidden="true" />
              </tr>
            ))}
            {/* Drop indicator at the very bottom when dragging past the last row */}
            {dropTargetIdx !== null && dropTargetIdx >= visibleRows.length && (
              <tr aria-hidden="true">
                <td
                  colSpan={columns.length + 3}
                  className="h-0.5 bg-blue-500 pointer-events-none"
                />
              </tr>
            )}
          </tbody>

          {columns.length > 0 && (
            // tfoot is sticky to the viewport bottom so aggregation stats and
            // the "+ New row" button stay reachable at any scroll position.
            // Background must be opaque so scrolled rows don't bleed through —
            // the /30 tint sits on the tr over this opaque base.
            <tfoot className="sticky bottom-0 z-[2] bg-surface shadow-[0_-4px_6px_-4px_rgba(0,0,0,0.1)] dark:shadow-[0_-4px_6px_-4px_rgba(0,0,0,0.4)]">
              {/*
               * Statistics row — always rendered when columns exist (even with zero
               * rows) so that the "+ New row" affordance in the leading handle cell
               * is reachable. Borders match the header row (top + vertical, full
               * opacity), no bottom border. Trailing right border is dropped on the
               * rightmost data cell to keep the table edge clean.
               */}
              <tr className="bg-surface-overlay/30">
                {/* Leading handle cell — hosts the persistent "+ New row" button. */}
                <td className="sticky left-0 z-[3] w-8 bg-surface align-middle">
                  <div className="group relative mx-auto flex h-6 w-6 items-center justify-center">
                    <button
                      type="button"
                      onClick={() => void handleAddRow()}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-muted-text hover:bg-surface-overlay hover:text-neutral-ink transition-colors"
                      aria-label="New row"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                    <span className="pointer-events-none absolute left-full top-1/2 z-10 ml-1.5 -translate-y-1/2 whitespace-nowrap rounded-md bg-neutral-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 dark:bg-neutral-700">
                      New row
                    </span>
                  </div>
                </td>
                {/* Title column spacer in footer */}
                <td className="border-t border-r border-[var(--glass-border)]" />
                {columns.map((col, idx) => {
                  const options = getAggregationOptions(col.type)
                  const aggregation = col.aggregation ?? 'none'
                  // Aggregation runs on the filtered row set so the stats
                  // reflect what the user is actually looking at.
                  const value = computeAggregation(filteredRows, col)
                  const isNone = aggregation === 'none'
                  const hasValue = !isNone && value !== ''
                  return (
                    <td
                      key={col.id}
                      className={cn(
                        'px-3 py-2 border-t border-[var(--glass-border)] text-xs',
                        idx < columns.length - 1 && 'border-r'
                      )}
                    >
                      <div className="flex items-center justify-end gap-1.5">
                        {hasValue && (
                          <span className="truncate font-medium text-neutral-ink">{value}</span>
                        )}
                        {isNone ? (
                          // 'None' state: show only a faint chevron, with an invisible
                          // native <select> overlaid for the click target. The popup
                          // still renders the option labels normally.
                          <span className="relative inline-flex h-3.5 w-3.5 items-center justify-center">
                            <ChevronDown className="h-3 w-3 text-muted-text/40 transition-colors group-hover:text-muted-text pointer-events-none" />
                            <select
                              value={aggregation}
                              onChange={(e) =>
                                void handleAggregationChange(
                                  col,
                                  e.target.value as DatabaseAggregation
                                )
                              }
                              className="absolute inset-0 cursor-pointer opacity-0"
                              aria-label={`Aggregation for ${col.name}`}
                            >
                              {options.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </span>
                        ) : (
                          <select
                            value={aggregation}
                            onChange={(e) =>
                              void handleAggregationChange(
                                col,
                                e.target.value as DatabaseAggregation
                              )
                            }
                            className="cursor-pointer bg-transparent text-[10px] text-muted-text outline-none transition-colors hover:text-neutral-ink"
                            aria-label={`Aggregation for ${col.name}`}
                          >
                            {options.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </td>
                  )
                })}
                {/* Borderless trailing cell */}
                <td className="w-16 min-w-16" aria-hidden="true" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Column header dropdown — keyed on the column id so opening a different
          column remounts with a fresh draft state. */}
      {activeColumn && (
        <ColumnHeaderMenu
          key={activeColumn.id}
          isOpen={openColumnId !== null}
          position={menuPosition}
          column={activeColumn}
          onClose={closeColumnMenu}
          onChangeName={(newName) => handleColumnRename(activeColumn.id, newName)}
          onChangeType={(newType) => handleColumnTypeChange(activeColumn.id, newType)}
          onChangeNumberFormat={(format) => handleColumnNumberFormatChange(activeColumn.id, format)}
          onChangeOptions={(opts) => handleColumnOptionsChange(activeColumn.id, opts)}
          onInsertLeft={() => handleInsertColumn(activeColumn.id, 'left')}
          onInsertRight={() => handleInsertColumn(activeColumn.id, 'right')}
          onDelete={() => handleColumnDelete(activeColumn.id)}
        />
      )}

      {/* Note popup modal — renders the row's markdown in an inline editor. */}
      {popupFilePath && (
        <NotePopupModal
          relativePath={popupFilePath}
          onClose={closePopup}
          onSaved={() => void reload()}
          onRename={handlePopupRename}
        />
      )}
    </div>
  )
}
