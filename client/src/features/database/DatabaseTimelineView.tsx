import { databaseApi } from '@renderer/features/database/api'
/**
 * DatabaseTimelineView - Horizontal Gantt-style timeline view.
 *
 * Renders rows as horizontal bars on a scrollable time axis.
 * - date columns: single-day dot/bar
 * - date-range columns: start–end span bar
 * Rows without dates appear in an "Unscheduled" section below.
 */

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useEffect,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement
} from 'react'
import {
  format,
  addDays,
  subDays,
  differenceInCalendarDays,
  startOfDay,
  eachDayOfInterval,
  isToday,
  min as dateMin,
  max as dateMax
} from 'date-fns'
import { GanttChart, Plus, ZoomIn, ZoomOut } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type {
  DatabaseColumnSchema,
  DatabaseFilterCondition,
  DatabaseRow,
  DatabaseSortRule,
  DatabaseViewState,
  SortDirection,
  TimelineViewConfig
} from '@shared/database'
import { useDatabaseView } from './hooks/useDatabaseView'
import { useWorkspaceStore } from '@renderer/features/database/workspaceStore'
import { EmptyViewState } from './components/EmptyViewState'
import { NotePopupModal } from './components/NotePopupModal'
import { useRowContextMenu } from './components/RowContextMenu'
import { DateColumnSelector } from './components/DateColumnSelector'
import { ViewFilterSortToolbar } from './components/ViewFilterSortToolbar'
import { computeTimelineDragValue, type TimelineDragMode } from './utils/timelineDrag'
import { applyFilter } from './utils/filterEvaluator'
import { deriveDefaultsFromFilter } from './utils/filterDefaults'
import { applySort } from './utils/rowSort'
import { mergeViewConfig, readViewState } from './viewConfigHelpers'
import { databaseRowFilePath } from './utils/rowFilePath'

interface DatabaseTimelineViewProps {
  databaseFolderPath: string
}

type ZoomLevel = 'day' | 'week' | 'month'

interface ZoomConfig {
  dayWidth: number
  headerFormat: string
  label: string
}

const ZOOM_CONFIGS: Record<ZoomLevel, ZoomConfig> = {
  day: { dayWidth: 48, headerFormat: 'dd', label: 'Day' },
  week: { dayWidth: 24, headerFormat: 'dd', label: 'Week' },
  month: { dayWidth: 8, headerFormat: 'dd', label: 'Month' }
}

const ROW_HEIGHT = 32
const ROW_GAP = 2
const HEADER_HEIGHT = 48
const TIMELINE_PADDING_DAYS = 7
const EDGE_HANDLE_WIDTH = 6
const DRAG_THRESHOLD_PX = 3
const ROW_DRAG_MIME = 'application/x-maek-row-id'

interface DragState {
  rowId: string
  mode: TimelineDragMode
  originX: number
  originStart: Date
  originEnd: Date
  preview: { start: Date; end: Date } | null
}

interface ParsedRowDate {
  row: DatabaseRow
  start: Date
  end: Date
}

function parseDateValue(
  row: DatabaseRow,
  column: DatabaseColumnSchema
): { start: Date; end: Date } | null {
  const raw = row.yamlData[column.name]
  if (!raw) return null

  if (column.type === 'date-range') {
    const obj = raw as { start?: string | null; end?: string | null }
    const s = obj?.start ? new Date(obj.start) : null
    const e = obj?.end ? new Date(obj.end) : null
    if (s && !isNaN(s.getTime())) {
      return {
        start: startOfDay(s),
        end: e && !isNaN(e.getTime()) ? startOfDay(e) : startOfDay(s)
      }
    }
    return null
  }

  // Single date column
  if (typeof raw === 'string') {
    const d = new Date(raw)
    if (!isNaN(d.getTime())) {
      return { start: startOfDay(d), end: startOfDay(d) }
    }
  }
  return null
}

export function DatabaseTimelineView({
  databaseFolderPath
}: DatabaseTimelineViewProps): ReactElement {
  const rootPath = useWorkspaceStore((s) => s.rootPath)
  const {
    meta,
    rows,
    addRow,
    deleteRow,
    reload,
    updateCell,
    updateSchema,
    suspendWatcher,
    resumeWatcher
  } = useDatabaseView(databaseFolderPath)

  const { openFor: openRowContextMenu, menu: rowContextMenu } = useRowContextMenu(
    (rowId) => void deleteRow(rowId)
  )

  const [popupFilePath, setPopupFilePath] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [unscheduledDragRowId, setUnscheduledDragRowId] = useState<string | null>(null)
  const [isTimelineDropActive, setIsTimelineDropActive] = useState(false)
  const timelineRef = useRef<HTMLDivElement>(null)
  // Tracks whether the most recently completed pointer interaction was a drag,
  // so the synthetic click that follows pointerup can be ignored without
  // suppressing real clicks.
  const justDraggedRef = useRef(false)

  // Subscribe to viewConfig so the date selector / filter / sort / zoom react
  // to store updates (including when our own persist call round-trips).
  const dbEntry = useWorkspaceStore((s) =>
    meta ? s.databases.find((d) => d.id === meta.id) : undefined
  )
  const timelineConfig = useMemo<TimelineViewConfig | null>(() => {
    if (!dbEntry?.viewConfig) return null
    return dbEntry.viewConfig.type === 'timeline' ? dbEntry.viewConfig.config : null
  }, [dbEntry])

  const [zoom, setZoom] = useState<ZoomLevel>(() => timelineConfig?.zoom ?? 'week')

  const columns = useMemo<DatabaseColumnSchema[]>(() => {
    if (!meta) return []
    return [...meta.schema].sort((a, b) => a.order - b.order)
  }, [meta])

  const dateColumnCandidates = useMemo<DatabaseColumnSchema[]>(
    () => columns.filter((c) => c.type === 'date' || c.type === 'date-range'),
    [columns]
  )

  // Resolve the effective date column. Config wins when its id still exists;
  // otherwise prefer `date-range` and fall back to `date`.
  const dateColumn = useMemo<DatabaseColumnSchema | null>(() => {
    if (!meta) return null
    const configDateId = timelineConfig?.dateColumnId ?? null
    if (configDateId) {
      const col = meta.schema.find((c) => c.id === configDateId)
      if (col && (col.type === 'date' || col.type === 'date-range')) return col
    }
    return (
      dateColumnCandidates.find((c) => c.type === 'date-range') ?? dateColumnCandidates[0] ?? null
    )
  }, [meta, timelineConfig, dateColumnCandidates])

  // --- Sort + filter view state, persisted into TimelineViewConfig ---
  // See DatabaseKanbanView for why `hydratedForId` is state (not a ref).
  const [viewState, setViewState] = useState<DatabaseViewState>(() =>
    readViewState(timelineConfig ?? undefined)
  )
  const [hydratedForId, setHydratedForId] = useState<string | null>(null)
  useEffect(() => {
    if (!meta) return
    if (hydratedForId === meta.id) return
    setViewState(readViewState(timelineConfig ?? undefined))
    if (timelineConfig?.zoom) setZoom(timelineConfig.zoom)
    setHydratedForId(meta.id)
  }, [meta, timelineConfig, hydratedForId])

  const databaseIdRef = useRef<string | null>(null)
  useEffect(() => {
    databaseIdRef.current = meta?.id ?? null
  }, [meta?.id])

  const persistTimelineConfig = useCallback(
    async (patch: Partial<TimelineViewConfig>): Promise<void> => {
      const databaseId = databaseIdRef.current
      if (!rootPath || !databaseId) return
      const live = useWorkspaceStore.getState().databases.find((d) => d.id === databaseId)
      const activeViewId = live?.activeViewId
      if (!activeViewId) return
      const liveConfig: TimelineViewConfig =
        live?.viewConfig?.type === 'timeline'
          ? live.viewConfig.config
          : { dateColumnId: null, zoom: 'week' }
      const nextConfig = mergeViewConfig<TimelineViewConfig>(liveConfig, patch)
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

  useEffect(() => {
    const id = meta?.id
    if (!id || hydratedForId !== id) return
    void persistTimelineConfig({ sort: viewState.sort })
  }, [viewState.sort, hydratedForId, meta?.id, persistTimelineConfig])

  useEffect(() => {
    const id = meta?.id
    if (!id || hydratedForId !== id) return
    const handle = setTimeout(() => {
      void persistTimelineConfig({ filter: viewState.filter })
    }, 300)
    return () => clearTimeout(handle)
  }, [viewState.filter, hydratedForId, meta?.id, persistTimelineConfig])

  // Persist zoom immediately whenever it changes after hydration so the
  // user's preferred scale survives app restart.
  useEffect(() => {
    const id = meta?.id
    if (!id || hydratedForId !== id) return
    void persistTimelineConfig({ zoom })
  }, [zoom, hydratedForId, meta?.id, persistTimelineConfig])

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
  const handleChangeDateColumn = useCallback(
    async (columnId: string): Promise<void> => {
      await persistTimelineConfig({ dateColumnId: columnId })
    },
    [persistTimelineConfig]
  )

  // Apply filter then sort. Sort controls the vertical row order in the
  // Gantt body; unscheduled rows inherit the same ordering.
  const visibleRows = useMemo(() => {
    const filtered = applyFilter(rows, columns, viewState.filter)
    return viewState.sort.length > 0 ? applySort(filtered, columns, viewState.sort) : filtered
  }, [rows, columns, viewState.filter, viewState.sort])

  // Parse row dates
  const { scheduled, unscheduled } = useMemo(() => {
    const scheduled: ParsedRowDate[] = []
    const unscheduled: DatabaseRow[] = []

    if (!dateColumn) return { scheduled, unscheduled }

    for (const row of visibleRows) {
      const parsed = parseDateValue(row, dateColumn)
      if (parsed) {
        scheduled.push({ row, ...parsed })
      } else {
        unscheduled.push(row)
      }
    }

    return { scheduled, unscheduled }
  }, [visibleRows, dateColumn])

  // Calculate the time range for the timeline
  const { timelineStart, timelineEnd, totalDays } = useMemo(() => {
    if (scheduled.length === 0) {
      const today = startOfDay(new Date())
      return {
        timelineStart: subDays(today, 14),
        timelineEnd: addDays(today, 30),
        totalDays: 44
      }
    }

    const allStarts = scheduled.map((s) => s.start)
    const allEnds = scheduled.map((s) => s.end)
    const earliest = dateMin(allStarts)
    const latest = dateMax(allEnds)

    const timelineStart = subDays(earliest, TIMELINE_PADDING_DAYS)
    const timelineEnd = addDays(latest, TIMELINE_PADDING_DAYS)
    const totalDays = differenceInCalendarDays(timelineEnd, timelineStart) + 1

    return { timelineStart, timelineEnd, totalDays }
  }, [scheduled])

  const zoomConfig = ZOOM_CONFIGS[zoom]
  const totalWidth = totalDays * zoomConfig.dayWidth

  // Generate header ticks
  const headerDays = useMemo(() => {
    return eachDayOfInterval({ start: timelineStart, end: timelineEnd })
  }, [timelineStart, timelineEnd])

  // Group header days into month labels
  const monthLabels = useMemo(() => {
    const labels: { month: string; startIdx: number; span: number }[] = []
    let currentMonth = ''
    for (let i = 0; i < headerDays.length; i++) {
      const month = format(headerDays[i], 'MMM yyyy')
      if (month !== currentMonth) {
        labels.push({ month, startIdx: i, span: 1 })
        currentMonth = month
      } else {
        labels[labels.length - 1]!.span++
      }
    }
    return labels
  }, [headerDays])

  const scrollToToday = useCallback((): void => {
    const el = timelineRef.current
    if (!el) return
    const todayOffset = differenceInCalendarDays(new Date(), timelineStart)
    const scrollTarget = todayOffset * zoomConfig.dayWidth - el.clientWidth / 3
    el.scrollLeft = Math.max(0, scrollTarget)
  }, [timelineStart, zoomConfig.dayWidth])

  // Scroll to today on mount
  useEffect(() => {
    scrollToToday()
  }, [scrollToToday])

  const handleRowClick = useCallback(
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
      // newFileName arrives with `.md` already appended by the title bar.
      const newTitle = newFileName.replace(/\.md$/i, '')
      const result = await databaseApi.databaseRenameRow(rootPath, meta.id, currentRow.id, newTitle)
      if (!result.success) throw new Error(result.error)
      const newPath = databaseRowFilePath(meta.folderPath, result.row.fileName)
      // Drive the popup to reload from the new path. The modal's load effect
      // tears down the old tab and re-injects a fresh one keyed by newPath.
      setPopupFilePath(newPath)
      await reload()
    },
    [rootPath, meta, rows, popupFilePath, reload]
  )

  const handleAddRow = useCallback(async (): Promise<void> => {
    if (!dateColumn) return
    const now = new Date()
    const today = format(now, 'yyyy-MM-dd')
    const tomorrow = format(addDays(now, 1), 'yyyy-MM-dd')
    const timelineDefault =
      dateColumn.type === 'date-range' ? { start: today, end: tomorrow } : today
    // Filter-derived defaults take priority over the timeline's today fallback
    // so a date filter like `date-after 2030-01-01` lands in a satisfying day,
    // not today. Non-date filter conditions are also injected so the new row
    // survives view-switches without an out-of-band whitelist.
    const filterDefaults = deriveDefaultsFromFilter(viewState.filter, columns)
    const payload = { [dateColumn.name]: timelineDefault, ...filterDefaults }
    await addRow(payload)
  }, [addRow, dateColumn, viewState.filter, columns])

  const cycleZoom = useCallback((direction: 'in' | 'out') => {
    const levels: ZoomLevel[] = ['month', 'week', 'day']
    setZoom((current) => {
      const idx = levels.indexOf(current)
      if (direction === 'in') return levels[Math.min(idx + 1, levels.length - 1)]!
      return levels[Math.max(idx - 1, 0)]!
    })
  }, [])

  // Compute the candidate {start, end} given a snapped deltaDays for a drag mode.
  const computePreviewRange = useCallback(
    (state: DragState, deltaDays: number): { start: Date; end: Date } => {
      const { mode, originStart, originEnd } = state
      switch (mode) {
        case 'move':
          return {
            start: addDays(originStart, deltaDays),
            end: addDays(originEnd, deltaDays)
          }
        case 'resize-start': {
          const candidate = addDays(originStart, deltaDays)
          // Min 1-day duration: clamp start to <= end.
          const clampedStart = candidate.getTime() > originEnd.getTime() ? originEnd : candidate
          return { start: clampedStart, end: originEnd }
        }
        case 'resize-end': {
          const candidate = addDays(originEnd, deltaDays)
          const clampedEnd = candidate.getTime() < originStart.getTime() ? originStart : candidate
          return { start: originStart, end: clampedEnd }
        }
      }
    },
    []
  )

  const beginDrag = useCallback(
    (
      e: ReactPointerEvent<HTMLDivElement>,
      row: DatabaseRow,
      start: Date,
      end: Date,
      mode: TimelineDragMode
    ) => {
      if (e.button !== 0) return
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      setDrag({
        rowId: row.id,
        mode,
        originX: e.clientX,
        originStart: start,
        originEnd: end,
        preview: null
      })
      suspendWatcher()
    },
    [suspendWatcher]
  )

  const handleDragPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!drag) return
      const deltaPx = e.clientX - drag.originX
      if (drag.preview === null && Math.abs(deltaPx) < DRAG_THRESHOLD_PX) return
      const deltaDays = Math.round(deltaPx / zoomConfig.dayWidth)
      const preview = computePreviewRange(drag, deltaDays)
      setDrag((prev) => (prev ? { ...prev, preview } : prev))
    },
    [drag, zoomConfig.dayWidth, computePreviewRange]
  )

  const handleDragPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!drag) return
      const wasDragged = drag.preview !== null
      // Always release pointer + suspended watcher regardless of click/drag outcome.
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        // pointer was never captured on this element — ignore
      }

      if (!wasDragged) {
        setDrag(null)
        resumeWatcher()
        return
      }

      const row = rows.find((r) => r.id === drag.rowId)
      if (!row || !dateColumn) {
        setDrag(null)
        resumeWatcher()
        return
      }

      const deltaDays = Math.round((e.clientX - drag.originX) / zoomConfig.dayWidth)
      const next = computeTimelineDragValue({
        columnType: dateColumn.type as 'date' | 'date-range',
        currentValue: row.yamlData[dateColumn.name],
        mode: drag.mode,
        deltaDays
      })

      justDraggedRef.current = true
      // Suppress the synthetic click on the next tick.
      window.setTimeout(() => {
        justDraggedRef.current = false
      }, 0)

      const finalize = (): void => {
        setDrag(null)
        resumeWatcher()
      }

      if (next === null) {
        finalize()
        return
      }

      void updateCell(drag.rowId, dateColumn.name, next).finally(finalize)
    },
    [drag, rows, dateColumn, zoomConfig.dayWidth, updateCell, resumeWatcher]
  )

  const handleDragPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!drag) return
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        // ignore
      }
      setDrag(null)
      resumeWatcher()
    },
    [drag, resumeWatcher]
  )

  // Escape to cancel an in-progress drag.
  useEffect(() => {
    if (!drag) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setDrag(null)
        resumeWatcher()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [drag, resumeWatcher])

  const handleUnscheduledDragStart = useCallback(
    (row: DatabaseRow) => (e: DragEvent<HTMLElement>) => {
      e.stopPropagation()
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData(ROW_DRAG_MIME, row.id)
      e.dataTransfer.setData('text/plain', row.id)
      setUnscheduledDragRowId(row.id)
      suspendWatcher()
    },
    [suspendWatcher]
  )

  const handleUnscheduledDragEnd = useCallback(() => {
    setUnscheduledDragRowId(null)
    setIsTimelineDropActive(false)
    resumeWatcher()
  }, [resumeWatcher])

  const handleTimelineDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (unscheduledDragRowId === null) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setIsTimelineDropActive(true)
    },
    [unscheduledDragRowId]
  )

  const handleTimelineDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setIsTimelineDropActive(false)
  }, [])

  const handleTimelineDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setIsTimelineDropActive(false)
      if (!dateColumn) return

      const rowId = unscheduledDragRowId ?? e.dataTransfer.getData(ROW_DRAG_MIME)
      if (!rowId) return
      const row = rows.find((r) => r.id === rowId)
      if (!row) return

      const el = timelineRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left + el.scrollLeft
      const dayIndex = Math.floor(x / zoomConfig.dayWidth)
      if (dayIndex < 0 || dayIndex >= totalDays) return

      const droppedDay = format(addDays(timelineStart, dayIndex), 'yyyy-MM-dd')
      const next =
        dateColumn.type === 'date-range' ? { start: droppedDay, end: droppedDay } : droppedDay
      await updateCell(rowId, dateColumn.name, next)
    },
    [
      dateColumn,
      rows,
      timelineStart,
      totalDays,
      unscheduledDragRowId,
      updateCell,
      zoomConfig.dayWidth
    ]
  )

  // No date column — show setup prompt with CTA to add a Period column.
  if (!dateColumn) {
    return (
      <EmptyViewState
        icon={<GanttChart className="w-10 h-10" />}
        title="Timeline View"
        description="Add a Period column to enable Timeline view"
        actionLabel="Add Period Column"
        onAction={async () => {
          if (!meta) return
          const newCol: DatabaseColumnSchema = {
            id: crypto.randomUUID(),
            name: 'Period',
            type: 'date-range',
            order: meta.schema.length
          }
          await updateSchema([...meta.schema, newCol])
        }}
      />
    )
  }

  const todayOffset = differenceInCalendarDays(new Date(), timelineStart)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar: date-column selector + scheduled count on the left, zoom on the right */}
      <div className="flex items-center justify-between px-4 py-1.5 shrink-0">
        <div className="flex items-center gap-2">
          <DateColumnSelector
            columns={dateColumnCandidates}
            currentColumnId={dateColumn.id}
            onChange={handleChangeDateColumn}
          />
          <span className="text-xs text-muted-text">&middot;</span>
          <span className="text-xs text-muted-text">{scheduled.length} scheduled</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void handleAddRow()}
            className="flex items-center gap-1 px-2 h-6 rounded text-xs text-muted-text hover:text-neutral-ink hover:bg-surface-overlay transition-colors"
            title="New row"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New</span>
          </button>
          <span className="mx-1 h-4 w-px bg-default/60" aria-hidden />
          <button
            type="button"
            onClick={scrollToToday}
            className="px-2 h-6 rounded text-xs font-medium text-muted-text hover:text-neutral-ink hover:bg-surface-overlay transition-colors"
            title="Scroll to today"
          >
            Today
          </button>
          <span className="mx-1 h-4 w-px bg-default/60" aria-hidden />
          <button
            onClick={() => cycleZoom('out')}
            className="w-6 h-6 flex items-center justify-center rounded text-muted-text hover:text-neutral-ink hover:bg-surface-overlay transition-colors"
            aria-label="Zoom out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs text-muted-text w-12 text-center">{zoomConfig.label}</span>
          <button
            onClick={() => cycleZoom('in')}
            className="w-6 h-6 flex items-center justify-center rounded text-muted-text hover:text-neutral-ink hover:bg-surface-overlay transition-colors"
            aria-label="Zoom in"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <ViewFilterSortToolbar
        columns={columns}
        viewState={viewState}
        onSetFilter={setFilterForColumn}
        onClearFilter={clearFilterForColumn}
        onSetSort={setSortForColumn}
        onReorderSort={reorderSortRules}
        onClearAll={clearAllViewState}
      />

      {/* Scrollable timeline (full-width, no sidebar) */}
      <div
        ref={timelineRef}
        className={cn('flex-1 overflow-auto', isTimelineDropActive && 'bg-maek-red/[0.03]')}
        onDragOver={handleTimelineDragOver}
        onDragLeave={handleTimelineDragLeave}
        onDrop={(e) => void handleTimelineDrop(e)}
      >
        <div style={{ width: totalWidth, position: 'relative' }}>
          {/* Time header */}
          <div
            className="sticky top-0 z-10 bg-surface border-b border-default"
            style={{ height: HEADER_HEIGHT }}
          >
            {/* Month labels row */}
            <div className="flex h-1/2">
              {monthLabels.map((m) => (
                <div
                  key={`${m.month}-${m.startIdx}`}
                  className="text-[10px] font-medium text-muted-text flex items-center px-1 border-r border-default/30"
                  style={{ width: m.span * zoomConfig.dayWidth }}
                >
                  {m.month}
                </div>
              ))}
            </div>
            {/* Day labels row */}
            <div className="flex h-1/2">
              {headerDays.map((day, i) => {
                const today = isToday(day)
                const dow = day.getDay()
                const isWeekend = dow === 0 || dow === 6
                const isMonday = dow === 1
                const isFirstOfMonth = day.getDate() === 1
                return (
                  <div
                    key={i}
                    className={cn(
                      'text-[9px] flex items-center justify-center border-r border-default/20',
                      today && 'bg-maek-red/10 font-bold text-maek-red',
                      !today && isWeekend && 'bg-black/[0.05] dark:bg-white/[0.05]',
                      !today && 'text-muted-text',
                      (isMonday || isFirstOfMonth) && 'border-r-default/50'
                    )}
                    style={{ width: zoomConfig.dayWidth }}
                  >
                    {zoomConfig.dayWidth >= 16 ? format(day, zoomConfig.headerFormat) : ''}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Bars */}
          <div style={{ position: 'relative' }}>
            {/* Weekend column stripes (sit behind bars). */}
            {headerDays.map((day, i) => {
              const dow = day.getDay()
              if (dow !== 0 && dow !== 6) return null
              return (
                <div
                  key={`weekend-${i}`}
                  className="absolute top-0 bottom-0 bg-black/[0.04] dark:bg-white/[0.04] pointer-events-none"
                  style={{ left: i * zoomConfig.dayWidth, width: zoomConfig.dayWidth }}
                />
              )
            })}
            {scheduled.map(({ row, start, end }, i) => {
              const isDragging = drag?.rowId === row.id
              const renderStart = isDragging && drag.preview ? drag.preview.start : start
              const renderEnd = isDragging && drag.preview ? drag.preview.end : end

              const startOffset = differenceInCalendarDays(renderStart, timelineStart)
              const duration = differenceInCalendarDays(renderEnd, renderStart) + 1
              const left = startOffset * zoomConfig.dayWidth
              const width = Math.max(duration * zoomConfig.dayWidth, zoomConfig.dayWidth)
              const top = i * (ROW_HEIGHT + ROW_GAP) + ROW_GAP / 2
              const title = row.fileName.replace(/\.md$/, '')
              const isRange = dateColumn.type === 'date-range'

              const onBodyClick = (): void => {
                if (justDraggedRef.current) return
                handleRowClick(row)
              }

              return (
                <div
                  key={row.id}
                  className="absolute group"
                  style={{ left, top, width, height: ROW_HEIGHT }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onPointerDown={(e) => beginDrag(e, row, start, end, 'move')}
                    onPointerMove={handleDragPointerMove}
                    onPointerUp={handleDragPointerUp}
                    onPointerCancel={handleDragPointerCancel}
                    onClick={onBodyClick}
                    onContextMenu={openRowContextMenu(row.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleRowClick(row)
                      }
                    }}
                    className={cn(
                      'absolute inset-0 rounded-md bg-maek-red hover:bg-maek-red/90 transition-colors flex items-center px-2 select-none shadow-sm',
                      isDragging ? 'cursor-grabbing' : 'cursor-grab'
                    )}
                    title={title}
                  >
                    {/* Title is allowed to overflow the bar to the right so
                        short-duration rows still show their identity. The
                        text-shadow keeps the white label legible once it
                        spills onto the timeline background. */}
                    <span
                      className="text-[11px] text-white font-medium whitespace-nowrap pointer-events-none"
                      style={{ textShadow: '0 0 2px rgba(0,0,0,0.55), 0 1px 1px rgba(0,0,0,0.35)' }}
                    >
                      {title}
                    </span>
                  </div>
                  {isRange && (
                    <>
                      <div
                        onPointerDown={(e) => beginDrag(e, row, start, end, 'resize-start')}
                        onPointerMove={handleDragPointerMove}
                        onPointerUp={handleDragPointerUp}
                        onPointerCancel={handleDragPointerCancel}
                        className="absolute left-0 top-0 bottom-0 cursor-ew-resize bg-white/0 group-hover:bg-white/40 transition-colors"
                        style={{ width: EDGE_HANDLE_WIDTH }}
                        title="Drag to change start date"
                      />
                      <div
                        onPointerDown={(e) => beginDrag(e, row, start, end, 'resize-end')}
                        onPointerMove={handleDragPointerMove}
                        onPointerUp={handleDragPointerUp}
                        onPointerCancel={handleDragPointerCancel}
                        className="absolute right-0 top-0 bottom-0 cursor-ew-resize bg-white/0 group-hover:bg-white/40 transition-colors"
                        style={{ width: EDGE_HANDLE_WIDTH }}
                        title="Drag to change end date"
                      />
                    </>
                  )}
                </div>
              )
            })}

            {/* Today line */}
            {todayOffset >= 0 && todayOffset <= totalDays && (
              <div
                className="absolute top-0 bottom-0 w-px bg-red-500 z-5 pointer-events-none"
                style={{
                  left: todayOffset * zoomConfig.dayWidth + zoomConfig.dayWidth / 2,
                  height: scheduled.length * (ROW_HEIGHT + ROW_GAP) || HEADER_HEIGHT
                }}
              />
            )}

            {/* Ensure minimum height */}
            <div
              style={{
                height: Math.max(scheduled.length * (ROW_HEIGHT + ROW_GAP), 200)
              }}
            />
          </div>
        </div>
      </div>

      {/* Unscheduled rows */}
      {unscheduled.length > 0 && (
        <div className="shrink-0 border-t border-default px-4 py-2 max-h-[120px] overflow-y-auto">
          <p className="text-xs font-medium text-muted-text mb-1">
            Unscheduled ({unscheduled.length})
          </p>
          <div className="flex flex-wrap gap-1">
            {unscheduled.map((row) => {
              const title = row.fileName.replace(/\.md$/, '')
              const isDragging = unscheduledDragRowId === row.id
              return (
                <div
                  key={row.id}
                  role="button"
                  tabIndex={0}
                  draggable
                  onDragStart={handleUnscheduledDragStart(row)}
                  onDragEnd={handleUnscheduledDragEnd}
                  onClick={() => handleRowClick(row)}
                  onContextMenu={openRowContextMenu(row.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleRowClick(row)
                    }
                  }}
                  className={cn(
                    'px-2 py-1 text-xs rounded-md bg-surface-overlay text-muted-text hover:text-neutral-ink hover:bg-surface-overlay/80 transition-colors cursor-grab active:cursor-grabbing select-none',
                    isDragging && 'opacity-40'
                  )}
                >
                  {title}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {rowContextMenu}

      {/* Note popup modal */}
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
