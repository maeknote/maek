import { databaseApi } from '@renderer/features/database/api'
// DatabaseKanbanView — orchestrator for the kanban view.
//
// Owns only the concerns above the DnD layer:
//   - Resolve DatabaseMeta + the group (select) column used for lanes.
//   - Derive the laneOptions list and lane → rows mapping.
//   - Render KanbanBoard, feeding it drag handlers from useKanbanBoard.
//   - Handle non-DnD mutations: add card, add lane, change group column,
//     change lane color, open row in tab/popup.
//
// All drag state + commit flow lives in useKanbanBoard + applyKanbanDrop.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { ChevronDown, ChevronRight, Columns3, Loader2, SlidersHorizontal } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { FloatingMenu, type FloatingMenuPosition } from '@renderer/shared/components'
import type {
  DatabaseColumnSchema,
  DatabaseFilterCondition,
  DatabaseRow,
  DatabaseSortRule,
  DatabaseViewState,
  KanbanViewConfig,
  SortDirection
} from '@shared/database'
import { useDatabaseView } from './hooks/useDatabaseView'
import { useWorkspaceStore } from '@renderer/features/database/workspaceStore'
import { CardFieldPicker } from './components/CardFieldPicker'
import { EmptyViewState } from './components/EmptyViewState'
import { NotePopupModal } from './components/NotePopupModal'
import { useRowContextMenu } from './components/RowContextMenu'
import { SelectOptionsReorderList } from './components/SelectOptionsReorderList'
import { ViewFilterSortToolbar } from './components/ViewFilterSortToolbar'
import { KanbanBoard } from './kanban/KanbanBoard'
import { useKanbanBoard } from './kanban/useKanbanBoard'
import { UNCATEGORIZED } from './kanban/constants'
import { mergeViewConfig, readViewState } from './viewConfigHelpers'
import { applyFilter } from './utils/filterEvaluator'
import { deriveDefaultsFromFilter } from './utils/filterDefaults'
import { applySort } from './utils/rowSort'
import { databaseRowFilePath } from './utils/rowFilePath'

interface DatabaseKanbanViewProps {
  databaseFolderPath: string
}

export function DatabaseKanbanView({ databaseFolderPath }: DatabaseKanbanViewProps): ReactElement {
  const rootPath = useWorkspaceStore((s) => s.rootPath)
  const {
    meta,
    rows,
    isLoading,
    error,
    addRow,
    deleteRow,
    updateCell,
    updateSchema,
    renameRow,
    reload,
    applyAuthoritativeRows,
    suspendWatcher,
    resumeWatcher
  } = useDatabaseView(databaseFolderPath)

  const { openFor: openRowContextMenu, menu: rowContextMenu } = useRowContextMenu(
    (rowId) => void deleteRow(rowId)
  )

  const [popupFilePath, setPopupFilePath] = useState<string | null>(null)
  const [showGroupSelector, setShowGroupSelector] = useState(false)
  const [groupByMenuPos, setGroupByMenuPos] = useState<FloatingMenuPosition | null>(null)
  const groupByButtonRef = useRef<HTMLButtonElement>(null)

  // "Properties" toolbar menu — lets the user toggle which columns render
  // as preview fields on each card. Title is always shown implicitly.
  const [propertiesOpen, setPropertiesOpen] = useState(false)
  const [propertiesPos, setPropertiesPos] = useState<FloatingMenuPosition | null>(null)
  const propertiesButtonRef = useRef<HTMLButtonElement>(null)

  // Group-by nested flyout state (Part B — reorder options for the hovered
  // column). Hover opens with a short delay; smart placement (right when it
  // fits, otherwise left of the parent menu) keeps the flyout from ever
  // landing on top of the parent group-by menu.
  const [openFlyoutColId, setOpenFlyoutColId] = useState<string | null>(null)
  const [flyoutPos, setFlyoutPos] = useState<FloatingMenuPosition | null>(null)
  const flyoutInnerRef = useRef<HTMLDivElement>(null)
  const hoverOpenTimerRef = useRef<number | null>(null)
  const hoverCloseTimerRef = useRef<number | null>(null)
  const FLYOUT_MIN_WIDTH = 220

  // Clear pending timers on unmount.
  useEffect(() => {
    return () => {
      if (hoverOpenTimerRef.current !== null) window.clearTimeout(hoverOpenTimerRef.current)
      if (hoverCloseTimerRef.current !== null) window.clearTimeout(hoverCloseTimerRef.current)
    }
  }, [])

  const flyoutExtraDismissRefs = useMemo(() => [flyoutInnerRef], [])

  const columns = useMemo(() => {
    if (!meta) return []
    return [...meta.schema].sort((a, b) => a.order - b.order)
  }, [meta])

  const selectColumns = useMemo(() => columns.filter((c) => c.type === 'select'), [columns])

  const dbEntry = useWorkspaceStore((s) =>
    meta ? s.databases.find((d) => d.id === meta.id) : undefined
  )

  const kanbanConfig = useMemo<KanbanViewConfig | null>(() => {
    if (!dbEntry?.viewConfig) return null
    return dbEntry.viewConfig.type === 'kanban' ? dbEntry.viewConfig.config : null
  }, [dbEntry])

  const groupColumn = useMemo<DatabaseColumnSchema | null>(() => {
    if (!meta) return null
    const configGroupId = kanbanConfig?.groupColumnId ?? null
    if (configGroupId) {
      const col = meta.schema.find((c) => c.id === configGroupId)
      if (col) return col
    }
    return meta.schema.find((c) => c.type === 'select') ?? null
  }, [meta, kanbanConfig])

  const laneColors = useMemo(() => kanbanConfig?.laneColors ?? {}, [kanbanConfig])

  const laneOptions = useMemo<string[]>(() => (groupColumn?.options ?? []).slice(), [groupColumn])

  // --- Sort + filter view state, persisted into KanbanViewConfig ---
  //
  // Local React state drives rendering for snappy input; writes flow through
  // persistKanbanConfig (sort immediate, filter debounced 300ms).
  //
  // `hydratedForId` is STATE (not a ref) so setViewState and the hydration
  // marker land in the same React batch. If we used a ref, the ref update
  // would be visible synchronously to the persist effect in the same commit
  // while `viewState` was still the pre-hydration empty value — persisting
  // the empty state back to SQLite and overwriting the user's data. With a
  // state flag, the persist effect only sees `hydratedForId === meta.id`
  // on the render AFTER viewState has been updated.
  const [viewState, setViewState] = useState<DatabaseViewState>(() =>
    readViewState(kanbanConfig ?? undefined)
  )
  const [hydratedForId, setHydratedForId] = useState<string | null>(null)
  useEffect(() => {
    if (!meta) return
    if (hydratedForId === meta.id) return
    setViewState(readViewState(kanbanConfig ?? undefined))
    setHydratedForId(meta.id)
  }, [meta, kanbanConfig, hydratedForId])

  // Cards preview a subset of columns. When the user has explicitly picked
  // fields via the Properties menu, honour that order and selection. When
  // they haven't, fall back to the first few non-group columns. In both
  // cases the group column is excluded because its value is already
  // implicit from the lane the card sits in.
  const MAX_CARD_FIELDS = 6
  const cardFieldIds = kanbanConfig?.cardFieldIds
  const previewColumns = useMemo<DatabaseColumnSchema[]>(() => {
    if (cardFieldIds && cardFieldIds.length > 0) {
      const picked: DatabaseColumnSchema[] = []
      for (const id of cardFieldIds) {
        if (picked.length >= MAX_CARD_FIELDS) break
        const col = columns.find((c) => c.id === id)
        if (!col) continue
        if (groupColumn && col.id === groupColumn.id) continue
        picked.push(col)
      }
      return picked
    }
    return groupColumn
      ? columns.filter((c) => c.id !== groupColumn.id).slice(0, 3)
      : columns.slice(0, 3)
  }, [columns, groupColumn, cardFieldIds])

  // Filter rows before distributing into lanes. Filter-hidden cards drop out
  // of the DOM entirely so the user can't drag them.
  const filteredRows = useMemo(
    () => applyFilter(rows, columns, viewState.filter),
    [rows, columns, viewState.filter]
  )

  // Partition filtered rows into lanes. Intra-lane ordering follows the
  // user's sort rule when active; otherwise falls back to persisted
  // sortOrder (the current manual-reorder behavior).
  const lanesByKey = useMemo<Map<string, DatabaseRow[]>>(() => {
    const map = new Map<string, DatabaseRow[]>()
    if (!groupColumn) return map
    for (const opt of laneOptions) map.set(opt, [])
    map.set(UNCATEGORIZED, [])
    const optionSet = new Set(laneOptions)
    const ordered =
      viewState.sort.length > 0
        ? applySort(filteredRows, columns, viewState.sort)
        : [...filteredRows].sort((a, b) => a.sortOrder - b.sortOrder)
    for (const row of ordered) {
      const raw = row.yamlData[groupColumn.name]
      const value = typeof raw === 'string' ? raw.trim() : ''
      const key = value && optionSet.has(value) ? value : UNCATEGORIZED
      map.get(key)!.push(row)
    }
    return map
  }, [filteredRows, columns, groupColumn, laneOptions, viewState.sort])

  const { onDragStart, onDragEnd } = useKanbanBoard({
    workspacePath: rootPath ?? '',
    databaseId: meta?.id ?? '',
    groupColumn: groupColumn ?? ({} as DatabaseColumnSchema),
    rows,
    laneOptions,
    applyAuthoritativeRows,
    suspendWatcher,
    resumeWatcher,
    reload
  })

  // --- Non-DnD mutations -------------------------------------------------

  // See DatabaseTableView.persistTableConfig for why this uses a ref for the
  // database id: the persist effects below feed back into the store, which
  // would otherwise invalidate the callback's identity and spin an infinite
  // write loop.
  const databaseIdRef = useRef<string | null>(null)
  const fallbackGroupColumnIdRef = useRef<string | null>(null)
  useEffect(() => {
    databaseIdRef.current = meta?.id ?? null
  }, [meta?.id])
  useEffect(() => {
    fallbackGroupColumnIdRef.current = groupColumn?.id ?? null
  }, [groupColumn?.id])

  const persistKanbanConfig = useCallback(
    async (patch: Partial<KanbanViewConfig>) => {
      const databaseId = databaseIdRef.current
      if (!rootPath || !databaseId) return
      const liveDbEntry = useWorkspaceStore.getState().databases.find((d) => d.id === databaseId)
      const activeViewId = liveDbEntry?.activeViewId
      if (!activeViewId) return
      const liveConfig: KanbanViewConfig =
        liveDbEntry?.viewConfig?.type === 'kanban'
          ? liveDbEntry.viewConfig.config
          : { groupColumnId: fallbackGroupColumnIdRef.current }
      const next = mergeViewConfig<KanbanViewConfig>(liveConfig, patch)
      const result = await databaseApi.databaseUpdateView(rootPath, databaseId, activeViewId, {
        config: next
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

  // Persist sort immediately (low frequency action). Guards on `hydratedForId`
  // so we never persist pre-hydration viewState to SQLite.
  useEffect(() => {
    const id = meta?.id
    if (!id || hydratedForId !== id) return
    void persistKanbanConfig({ sort: viewState.sort })
  }, [viewState.sort, hydratedForId, meta?.id, persistKanbanConfig])

  // Debounce filter persistence so typing into a condition value doesn't
  // spam SQLite writes.
  useEffect(() => {
    const id = meta?.id
    if (!id || hydratedForId !== id) return
    const handle = setTimeout(() => {
      void persistKanbanConfig({ filter: viewState.filter })
    }, 300)
    return () => clearTimeout(handle)
  }, [viewState.filter, hydratedForId, meta?.id, persistKanbanConfig])

  // viewState mutators (same shape as DatabaseTableView's helpers).
  // Multi-rule sort: if the column already has a rule, update its direction
  // in place (preserves its priority position); otherwise append a new one.
  // `direction === null` removes the rule.
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
      return { ...prev, filter: { ...prev.filter, conditions: [...without, next] } }
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

  const openRowAsPage = useCallback(
    (row: DatabaseRow) => {
      const filePath = databaseRowFilePath(databaseFolderPath, row.fileName)
      const parentName = databaseFolderPath.split('/').pop() ?? ''
      useWorkspaceStore.getState().setFileOpenIntent({
        fileId: filePath,
        fileName: row.fileName,
        parentName,
        mode: 'pin',
        kind: 'file'
      })
    },
    [databaseFolderPath]
  )

  const openRowInPopup = useCallback(
    (row: DatabaseRow) => {
      if (!meta) return
      setPopupFilePath(databaseRowFilePath(meta.folderPath, row.fileName))
    },
    [meta]
  )

  const handlePopupRename = useCallback(
    async (newFileName: string): Promise<void> => {
      if (!rootPath || !meta || !popupFilePath) throw new Error('Workspace not ready')
      const currentRow = rows.find(
        (r) => databaseRowFilePath(meta.folderPath, r.fileName) === popupFilePath
      )
      if (!currentRow) throw new Error('Row not found for popup')
      const newTitle = newFileName.replace(/\.md$/i, '')
      const result = await databaseApi.databaseRenameRow(rootPath, meta.id, currentRow.id, newTitle)
      if (!result.success) throw new Error(result.error)
      const newPath = databaseRowFilePath(meta.folderPath, result.row.fileName)
      setPopupFilePath(newPath)
      await reload()
    },
    [rootPath, meta, rows, popupFilePath, reload]
  )

  const handleAddCard = useCallback(
    (laneKey: string) => {
      if (!groupColumn) return
      const laneValue = laneKey === UNCATEGORIZED ? '' : laneKey
      // Lane choice is the user's explicit intent for the group column, so it
      // overrides any filter-derived value on that same column.
      const filterDefaults = deriveDefaultsFromFilter(viewState.filter, columns)
      void addRow({ ...filterDefaults, [groupColumn.name]: laneValue })
    },
    [groupColumn, addRow, viewState.filter, columns]
  )

  const handleAddLane = useCallback(async () => {
    if (!groupColumn || !meta) return
    const existing = groupColumn.options ?? []
    let name = 'New Status'
    let counter = 1
    while (existing.includes(name)) {
      counter++
      name = `New Status ${counter}`
    }
    const updatedCol: DatabaseColumnSchema = {
      ...groupColumn,
      options: [...existing, name]
    }
    await updateSchema(meta.schema.map((c) => (c.id === groupColumn.id ? updatedCol : c)))
  }, [groupColumn, meta, updateSchema])

  // Effective list of card-field column ids: user override → explicit list,
  // otherwise the fallback preview list (non-group, first few). The picker
  // reflects this so the user sees what is actually rendered on the card.
  const effectiveCardFieldIds = useMemo<string[]>(
    () =>
      cardFieldIds && cardFieldIds.length > 0 ? cardFieldIds : previewColumns.map((c) => c.id),
    [cardFieldIds, previewColumns]
  )

  const toggleCardField = useCallback(
    (columnId: string, on: boolean) => {
      const base = effectiveCardFieldIds
      const next = on
        ? base.includes(columnId)
          ? base
          : [...base, columnId]
        : base.filter((id) => id !== columnId)
      void persistKanbanConfig({ cardFieldIds: next })
    },
    [effectiveCardFieldIds, persistKanbanConfig]
  )

  // Columns available in the Properties picker — excludes the group column
  // because its value is already implicit from the lane the card sits in.
  const propertiesPickerColumns = useMemo<DatabaseColumnSchema[]>(
    () => (groupColumn ? columns.filter((c) => c.id !== groupColumn.id) : columns),
    [columns, groupColumn]
  )

  const openPropertiesMenu = useCallback(() => {
    const el = propertiesButtonRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPropertiesPos({ x: rect.left, y: rect.bottom })
    setPropertiesOpen(true)
  }, [])

  const handleLaneColorChange = useCallback(
    (laneKey: string, colorKey: string) => {
      const next = { ...laneColors }
      if (colorKey === 'none') {
        delete next[laneKey]
      } else {
        next[laneKey] = colorKey
      }
      void persistKanbanConfig({ laneColors: next })
    },
    [laneColors, persistKanbanConfig]
  )

  const handleChangeGroupColumn = useCallback(
    async (columnId: string) => {
      setShowGroupSelector(false)
      setOpenFlyoutColId(null)
      await persistKanbanConfig({ groupColumnId: columnId })
    },
    [persistKanbanConfig]
  )

  const moveLane = useCallback(
    (laneKey: string, direction: 'left' | 'right') => {
      if (!groupColumn || !meta) return
      const opts = groupColumn.options ?? []
      const idx = opts.indexOf(laneKey)
      const swapIdx = direction === 'left' ? idx - 1 : idx + 1
      if (idx < 0 || swapIdx < 0 || swapIdx >= opts.length) return
      const next = [...opts]
      ;[next[idx], next[swapIdx]] = [next[swapIdx]!, next[idx]!]
      const updatedCol: DatabaseColumnSchema = { ...groupColumn, options: next }
      void updateSchema(meta.schema.map((c) => (c.id === groupColumn.id ? updatedCol : c)))
    },
    [groupColumn, meta, updateSchema]
  )

  const reorderOptionsForColumn = useCallback(
    (colId: string, next: string[]) => {
      if (!meta) return
      const col = meta.schema.find((c) => c.id === colId)
      if (!col) return
      const updatedCol: DatabaseColumnSchema = { ...col, options: next }
      void updateSchema(meta.schema.map((c) => (c.id === colId ? updatedCol : c)))
    },
    [meta, updateSchema]
  )

  // Append a brand-new option to a select / multi-select column's schema.
  // Wired into KanbanCardFieldEditor so users can create options inline from
  // a card's chip popover.
  const addColumnOption = useCallback(
    async (colId: string, newOption: string): Promise<void> => {
      if (!meta) throw new Error('Database is not ready')
      const col = meta.schema.find((c) => c.id === colId)
      if (!col) throw new Error('Column not found')
      const existing = col.options ?? []
      if (existing.includes(newOption)) return
      const updatedCol: DatabaseColumnSchema = { ...col, options: [...existing, newOption] }
      await updateSchema(meta.schema.map((c) => (c.id === colId ? updatedCol : c)))
    },
    [meta, updateSchema]
  )

  const handleCardUpdateCell = useCallback(
    async (rowId: string, columnName: string, value: unknown): Promise<void> => {
      await updateCell(rowId, columnName, value)
    },
    [updateCell]
  )

  const handleCardRenameRow = useCallback(
    (rowId: string, newTitle: string) => {
      void renameRow(rowId, newTitle)
    },
    [renameRow]
  )

  // Remove an option from a select column. When the deleted value happens to
  // be the current group column's option, rows holding that value naturally
  // fall into the UNCATEGORIZED lane on the next render (optionSet lookup
  // fails → fallback branch). Also drops any persisted lane color for the
  // now-defunct lane so the config doesn't accumulate stale keys.
  const removeOptionFromColumn = useCallback(
    (colId: string, value: string) => {
      if (!meta) return
      const col = meta.schema.find((c) => c.id === colId)
      if (!col) return
      const nextOptions = (col.options ?? []).filter((o) => o !== value)
      const updatedCol: DatabaseColumnSchema = { ...col, options: nextOptions }
      void updateSchema(meta.schema.map((c) => (c.id === colId ? updatedCol : c)))
      if (groupColumn && groupColumn.id === colId && laneColors[value]) {
        const nextColors = { ...laneColors }
        delete nextColors[value]
        void persistKanbanConfig({ laneColors: nextColors })
      }
    },
    [meta, updateSchema, groupColumn, laneColors, persistKanbanConfig]
  )

  const handleDeleteLane = useCallback(
    (laneKey: string) => {
      if (!groupColumn || laneKey === UNCATEGORIZED) return
      removeOptionFromColumn(groupColumn.id, laneKey)
    },
    [groupColumn, removeOptionFromColumn]
  )

  // Group-by menu open/close
  const openGroupByMenu = useCallback(() => {
    if (groupByButtonRef.current) {
      const rect = groupByButtonRef.current.getBoundingClientRect()
      setGroupByMenuPos({ x: rect.right, y: rect.bottom })
    }
    setShowGroupSelector(true)
  }, [])

  const closeGroupByMenu = useCallback(() => {
    setShowGroupSelector(false)
    setOpenFlyoutColId(null)
    if (hoverOpenTimerRef.current !== null) {
      window.clearTimeout(hoverOpenTimerRef.current)
      hoverOpenTimerRef.current = null
    }
    if (hoverCloseTimerRef.current !== null) {
      window.clearTimeout(hoverCloseTimerRef.current)
      hoverCloseTimerRef.current = null
    }
  }, [])

  // Hover intent for the nested flyout — 120 ms open, 200 ms close. Picks
  // left vs right of the option row based on viewport space so the flyout
  // never overlaps the parent group-by menu (FloatingMenu's auto-flip would
  // otherwise land on top of the parent when the right side overflows).
  const scheduleOpenFlyout = useCallback((colId: string, rowEl: HTMLElement) => {
    if (hoverCloseTimerRef.current !== null) {
      window.clearTimeout(hoverCloseTimerRef.current)
      hoverCloseTimerRef.current = null
    }
    if (hoverOpenTimerRef.current !== null) {
      window.clearTimeout(hoverOpenTimerRef.current)
    }
    const rect = rowEl.getBoundingClientRect()
    const pad = 8
    const fitsRight = rect.right + 4 + FLYOUT_MIN_WIDTH <= window.innerWidth - pad
    const x = fitsRight ? rect.right + 4 : Math.max(pad, rect.left - FLYOUT_MIN_WIDTH - 4)
    hoverOpenTimerRef.current = window.setTimeout(() => {
      setFlyoutPos({ x, y: rect.top })
      setOpenFlyoutColId(colId)
      hoverOpenTimerRef.current = null
    }, 120)
  }, [])

  const scheduleCloseFlyout = useCallback(() => {
    if (hoverOpenTimerRef.current !== null) {
      window.clearTimeout(hoverOpenTimerRef.current)
      hoverOpenTimerRef.current = null
    }
    if (hoverCloseTimerRef.current !== null) {
      window.clearTimeout(hoverCloseTimerRef.current)
    }
    hoverCloseTimerRef.current = window.setTimeout(() => {
      setOpenFlyoutColId(null)
      hoverCloseTimerRef.current = null
    }, 200)
  }, [])

  const cancelCloseFlyout = useCallback(() => {
    if (hoverCloseTimerRef.current !== null) {
      window.clearTimeout(hoverCloseTimerRef.current)
      hoverCloseTimerRef.current = null
    }
  }, [])

  const openFlyoutCol = useMemo(
    () => (openFlyoutColId ? (meta?.schema.find((c) => c.id === openFlyoutColId) ?? null) : null),
    [openFlyoutColId, meta]
  )

  // --- Fallback UIs ------------------------------------------------------

  if (meta && !groupColumn) {
    return (
      <EmptyViewState
        icon={<Columns3 className="w-10 h-10" />}
        title="Kanban View"
        description="Add a Select column to enable Kanban grouping"
        actionLabel="Add Status Column"
        onAction={async () => {
          if (!meta) return
          const newCol: DatabaseColumnSchema = {
            id: crypto.randomUUID(),
            name: 'Status',
            type: 'select',
            order: meta.schema.length,
            options: ['To Do', 'In Progress', 'Done']
          }
          await updateSchema([...meta.schema, newCol])
        }}
      />
    )
  }

  if (isLoading && rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-text">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }

  if (!meta || !groupColumn || !rootPath) {
    return (
      <div className="flex h-full items-center justify-center text-muted-text">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {error && <p role="alert" className="px-4 py-1 text-xs text-red-500">{error}</p>}
      <div className="flex items-center gap-3 px-4 py-1.5 text-xs text-muted-text shrink-0">
        <span>
          {filteredRows.length} {filteredRows.length === 1 ? 'card' : 'cards'}
          {filteredRows.length !== rows.length && (
            <span className="opacity-60"> of {rows.length}</span>
          )}
        </span>
        {isLoading && <Loader2 className="w-3 h-3 animate-spin" />}

        {selectColumns.length > 1 && (
          <div className="ml-auto">
            <button
              ref={groupByButtonRef}
              onClick={() => (showGroupSelector ? closeGroupByMenu() : openGroupByMenu())}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md hover:bg-surface-overlay transition-colors text-xs text-muted-text"
            >
              <span className="opacity-60">Group by:</span>
              <span className="text-neutral-ink font-medium">{groupColumn.name}</span>
              <ChevronDown className="w-3 h-3" />
            </button>
            <FloatingMenu
              isOpen={showGroupSelector}
              position={groupByMenuPos}
              onClose={closeGroupByMenu}
              anchorRef={groupByButtonRef}
              extraDismissRefs={flyoutExtraDismissRefs}
              minWidth={180}
            >
              {selectColumns.map((col) => {
                const isActiveGroup = col.id === groupColumn.id
                return (
                  <button
                    key={col.id}
                    type="button"
                    onClick={() => void handleChangeGroupColumn(col.id)}
                    onMouseEnter={(e) => scheduleOpenFlyout(col.id, e.currentTarget)}
                    onMouseLeave={scheduleCloseFlyout}
                    className={cn(
                      'w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs transition-colors',
                      isActiveGroup
                        ? 'text-neutral-ink font-medium bg-surface-overlay'
                        : 'text-muted-text hover:text-neutral-ink hover:bg-surface-overlay'
                    )}
                  >
                    <span className="flex-1 truncate">{col.name}</span>
                    <ChevronRight className="w-3 h-3 opacity-60" />
                  </button>
                )
              })}
            </FloatingMenu>

            {openFlyoutCol && (
              <FloatingMenu
                isOpen={showGroupSelector}
                position={flyoutPos}
                onClose={() => setOpenFlyoutColId(null)}
                minWidth={FLYOUT_MIN_WIDTH}
              >
                <div
                  ref={flyoutInnerRef}
                  onMouseEnter={cancelCloseFlyout}
                  onMouseLeave={scheduleCloseFlyout}
                  className="px-2 pt-2 pb-2"
                >
                  <div className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-text">
                    Reorder options
                  </div>
                  <div className="max-h-[60vh] overflow-y-auto">
                    <SelectOptionsReorderList
                      options={openFlyoutCol.options ?? []}
                      onReorder={(next) => reorderOptionsForColumn(openFlyoutCol.id, next)}
                      onRemove={(value) => removeOptionFromColumn(openFlyoutCol.id, value)}
                      droppableId={`groupby-options-${openFlyoutCol.id}`}
                    />
                  </div>
                </div>
              </FloatingMenu>
            )}
          </div>
        )}
      </div>

      <ViewFilterSortToolbar
        columns={columns}
        viewState={viewState}
        onSetFilter={setFilterForColumn}
        onClearFilter={clearFilterForColumn}
        onSetSort={setSortForColumn}
        onReorderSort={reorderSortRules}
        onClearAll={clearAllViewState}
        trailing={
          <button
            ref={propertiesButtonRef}
            type="button"
            onClick={() => (propertiesOpen ? setPropertiesOpen(false) : openPropertiesMenu())}
            className={cn(
              'flex items-center gap-1 px-2 py-0.5 rounded-md hover:bg-surface-overlay transition-colors',
              effectiveCardFieldIds.length > 0 && 'text-neutral-ink'
            )}
          >
            <SlidersHorizontal className="w-3 h-3" />
            <span>Properties</span>
            {effectiveCardFieldIds.length > 0 && (
              <span className="text-[10px] opacity-70">({effectiveCardFieldIds.length})</span>
            )}
          </button>
        }
      />

      <CardFieldPicker
        columns={propertiesPickerColumns}
        selectedIds={effectiveCardFieldIds}
        onToggle={toggleCardField}
        isOpen={propertiesOpen}
        position={propertiesPos}
        onClose={() => setPropertiesOpen(false)}
        anchorRef={propertiesButtonRef}
      />

      <KanbanBoard
        laneOptions={laneOptions}
        lanesByKey={lanesByKey}
        previewColumns={previewColumns}
        laneColors={laneColors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onAddCard={handleAddCard}
        onAddLane={() => void handleAddLane()}
        onOpenAsPage={openRowAsPage}
        onOpenInPopup={openRowInPopup}
        onLaneColorChange={handleLaneColorChange}
        onMoveLane={moveLane}
        onDeleteLane={handleDeleteLane}
        onCardContextMenu={openRowContextMenu}
        onUpdateCell={handleCardUpdateCell}
        onAddColumnOption={addColumnOption}
        onRenameRow={handleCardRenameRow}
      />

      {rowContextMenu}

      {popupFilePath && (
        <NotePopupModal
          relativePath={popupFilePath}
          onClose={() => setPopupFilePath(null)}
          onSaved={() => void reload()}
          onRename={handlePopupRename}
        />
      )}
    </div>
  )
}
