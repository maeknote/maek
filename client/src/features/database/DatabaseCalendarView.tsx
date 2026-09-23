import { databaseApi } from '@renderer/features/database/api'
/**
 * DatabaseCalendarView - Monthly calendar grid view for databases with a
 * date or date-range column.
 *
 * Multi-day events render as horizontal card bars that span their full range
 * across day cells (Google Calendar style). Bars are absolute-positioned in
 * a per-week overlay so they cross cell boundaries; lane assignment stacks
 * overlapping events vertically.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactElement
} from 'react'
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  parseISO,
  addMonths,
  subMonths,
  isSameMonth,
  isToday
} from 'date-fns'
import { Calendar, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type {
  CalendarViewConfig,
  DatabaseColumnSchema,
  DatabaseFilterCondition,
  DatabaseRow,
  DatabaseSortRule,
  DatabaseViewState,
  SortDirection
} from '@shared/database'
import { useDatabaseView } from './hooks/useDatabaseView'
import { useWorkspaceStore } from '@renderer/features/database/workspaceStore'
import { EmptyViewState } from './components/EmptyViewState'
import { NotePopupModal } from './components/NotePopupModal'
import { useRowContextMenu } from './components/RowContextMenu'
import { DateColumnSelector } from './components/DateColumnSelector'
import { ViewFilterSortToolbar } from './components/ViewFilterSortToolbar'
import { coerceDateString, parseDateRange } from './utils/cellFormat'
import { computeCalendarDropValue } from './utils/calendarDrag'
import { layoutCalendarWeeks, type CalendarRowDates } from './utils/calendarLayout'
import { applyFilter } from './utils/filterEvaluator'
import { deriveDefaultsFromFilter } from './utils/filterDefaults'
import { applySort } from './utils/rowSort'
import { databaseRowFilePath } from './utils/rowFilePath'
import { mergeViewConfig, readViewState } from './viewConfigHelpers'

const ROW_DRAG_MIME = 'application/x-maek-row-id'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const BAR_HEIGHT = 20
const BAR_GAP = 2
const DAY_HEADER_HEIGHT = 26
const MIN_WEEK_HEIGHT = 100

interface DatabaseCalendarViewProps {
  databaseFolderPath: string
}

function parseRowDates(
  row: DatabaseRow,
  column: DatabaseColumnSchema,
  columnType: 'date' | 'date-range'
): CalendarRowDates | null {
  if (columnType === 'date') {
    const key = coerceDateString(row.yamlData[column.name])
    if (!key) return null
    const d = parseISO(key)
    return { row, start: d, end: d }
  }
  const range = parseDateRange(row.yamlData[column.name])
  if (!range.start) return null
  const start = parseISO(range.start)
  const end = range.end ? parseISO(range.end) : start
  return { row, start, end }
}

function chunkIntoWeeks(days: Date[]): Date[][] {
  const out: Date[][] = []
  for (let i = 0; i < days.length; i += 7) out.push(days.slice(i, i + 7))
  return out
}

export function DatabaseCalendarView({
  databaseFolderPath
}: DatabaseCalendarViewProps): ReactElement {
  const rootPath = useWorkspaceStore((s) => s.rootPath)
  const {
    meta,
    rows,
    error,
    addRow,
    deleteRow,
    updateCell,
    updateSchema,
    reload,
    suspendWatcher,
    resumeWatcher
  } = useDatabaseView(databaseFolderPath)

  const { openFor: openRowContextMenu, menu: rowContextMenu } = useRowContextMenu(
    (rowId) => void deleteRow(rowId)
  )

  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()))
  const [popupFilePath, setPopupFilePath] = useState<string | null>(null)
  const [draggingRowId, setDraggingRowId] = useState<string | null>(null)
  const [hoverDayKey, setHoverDayKey] = useState<string | null>(null)

  // Subscribe to the database's viewConfig so UI reacts when the selected
  // date column / filter / sort changes.
  const dbEntry = useWorkspaceStore((s) =>
    meta ? s.databases.find((d) => d.id === meta.id) : undefined
  )
  const calendarConfig = useMemo<CalendarViewConfig | null>(() => {
    if (!dbEntry?.viewConfig) return null
    return dbEntry.viewConfig.type === 'calendar' ? dbEntry.viewConfig.config : null
  }, [dbEntry])

  // Candidate date/date-range columns, sorted by the schema's own order so
  // the selector list matches the other column-aware UIs.
  const dateColumnCandidates = useMemo<DatabaseColumnSchema[]>(() => {
    if (!meta) return []
    return [...meta.schema]
      .filter((c) => c.type === 'date' || c.type === 'date-range')
      .sort((a, b) => a.order - b.order)
  }, [meta])

  const columns = useMemo<DatabaseColumnSchema[]>(() => {
    if (!meta) return []
    return [...meta.schema].sort((a, b) => a.order - b.order)
  }, [meta])

  // Resolve the effective date column. Config wins if the id still exists;
  // otherwise prefer a plain `date` column and fall back to `date-range`.
  const dateColumn = useMemo<DatabaseColumnSchema | null>(() => {
    if (!meta) return null
    const configDateId = calendarConfig?.dateColumnId ?? null
    if (configDateId) {
      const col = meta.schema.find((c) => c.id === configDateId)
      if (col && (col.type === 'date' || col.type === 'date-range')) return col
    }
    return dateColumnCandidates.find((c) => c.type === 'date') ?? dateColumnCandidates[0] ?? null
  }, [meta, calendarConfig, dateColumnCandidates])

  const dateColumnType = dateColumn?.type as 'date' | 'date-range' | undefined

  // --- Sort + filter view state, persisted into CalendarViewConfig ---
  // See DatabaseKanbanView for why `hydratedForId` is state (not a ref).
  const [viewState, setViewState] = useState<DatabaseViewState>(() =>
    readViewState(calendarConfig ?? undefined)
  )
  const [hydratedForId, setHydratedForId] = useState<string | null>(null)
  useEffect(() => {
    if (!meta) return
    if (hydratedForId === meta.id) return
    setViewState(readViewState(calendarConfig ?? undefined))
    setHydratedForId(meta.id)
  }, [meta, calendarConfig, hydratedForId])

  const databaseIdRef = useRef<string | null>(null)
  useEffect(() => {
    databaseIdRef.current = meta?.id ?? null
  }, [meta?.id])

  const persistCalendarConfig = useCallback(
    async (patch: Partial<CalendarViewConfig>): Promise<void> => {
      const databaseId = databaseIdRef.current
      if (!rootPath || !databaseId) return
      const live = useWorkspaceStore.getState().databases.find((d) => d.id === databaseId)
      const activeViewId = live?.activeViewId
      if (!activeViewId) return
      const liveConfig: CalendarViewConfig =
        live?.viewConfig?.type === 'calendar' ? live.viewConfig.config : { dateColumnId: null }
      const nextConfig = mergeViewConfig<CalendarViewConfig>(liveConfig, patch)
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
    void persistCalendarConfig({ sort: viewState.sort })
  }, [viewState.sort, hydratedForId, meta?.id, persistCalendarConfig])

  useEffect(() => {
    const id = meta?.id
    if (!id || hydratedForId !== id) return
    const handle = setTimeout(() => {
      void persistCalendarConfig({ filter: viewState.filter })
    }, 300)
    return () => clearTimeout(handle)
  }, [viewState.filter, hydratedForId, meta?.id, persistCalendarConfig])

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
      await persistCalendarConfig({ dateColumnId: columnId })
    },
    [persistCalendarConfig]
  )

  // Build the calendar grid days (always full weeks: Sun..Sat).
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth)
    const monthEnd = endOfMonth(currentMonth)
    const gridStart = startOfWeek(monthStart)
    const gridEnd = endOfWeek(monthEnd)
    return eachDayOfInterval({ start: gridStart, end: gridEnd })
  }, [currentMonth])

  const weeks = useMemo(() => chunkIntoWeeks(calendarDays), [calendarDays])

  // Apply filter then sort before assigning events to the calendar grid.
  // Sort affects intra-day event ordering and influences overlap lane
  // assignment when multiple events compete for the same row.
  const visibleRows = useMemo(() => {
    const filtered = applyFilter(rows, columns, viewState.filter)
    return viewState.sort.length > 0 ? applySort(filtered, columns, viewState.sort) : filtered
  }, [rows, columns, viewState.filter, viewState.sort])

  // Parse rows into {start, end} events; rows without a usable date go to unscheduled.
  const { events, unscheduled } = useMemo(() => {
    const events: CalendarRowDates[] = []
    const unscheduled: DatabaseRow[] = []
    if (!dateColumn || !dateColumnType) return { events, unscheduled }

    for (const row of visibleRows) {
      const parsed = parseRowDates(row, dateColumn, dateColumnType)
      if (parsed) events.push(parsed)
      else unscheduled.push(row)
    }
    return { events, unscheduled }
  }, [visibleRows, dateColumn, dateColumnType])

  const weekLayouts = useMemo(() => layoutCalendarWeeks(weeks, events), [weeks, events])

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
      const newTitle = newFileName.replace(/\.md$/i, '')
      const result = await databaseApi.databaseRenameRow(rootPath, meta.id, currentRow.id, newTitle)
      if (!result.success) throw new Error(result.error)
      const newPath = databaseRowFilePath(meta.folderPath, result.row.fileName)
      setPopupFilePath(newPath)
      await reload()
    },
    [rootPath, meta, rows, popupFilePath, reload]
  )

  const handleDayClick = useCallback(
    async (day: Date) => {
      if (!dateColumn || !dateColumnType) return
      const dayKey = format(day, 'yyyy-MM-dd')
      const dayValue = dateColumnType === 'date-range' ? { start: dayKey, end: dayKey } : dayKey
      // The clicked day is the user's explicit intent for the date column,
      // so it overrides any filter-derived value on that same column. Other
      // filter conditions are still injected so the new row stays visible.
      const filterDefaults = deriveDefaultsFromFilter(viewState.filter, columns)
      await addRow({ ...filterDefaults, [dateColumn.name]: dayValue })
    },
    [addRow, dateColumn, dateColumnType, viewState.filter, columns]
  )

  const handleChipDragStart = useCallback(
    (row: DatabaseRow) => (e: DragEvent<HTMLElement>) => {
      e.stopPropagation()
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData(ROW_DRAG_MIME, row.id)
      // Some browsers require non-empty text/plain for the drag image to render.
      e.dataTransfer.setData('text/plain', row.id)
      setDraggingRowId(row.id)
      suspendWatcher()
    },
    [suspendWatcher]
  )

  const handleChipDragEnd = useCallback(() => {
    setDraggingRowId(null)
    setHoverDayKey(null)
    resumeWatcher()
  }, [resumeWatcher])

  const handleDayDragOver = useCallback(
    (key: string) => (e: DragEvent<HTMLDivElement>) => {
      // While a row drag is active, always allow drop and highlight. We don't
      // gate on dataTransfer.types here because some browsers (and Electron
      // builds) don't reliably surface custom MIME types during dragover —
      // the source rowId is verified at drop time below.
      if (draggingRowId === null) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setHoverDayKey((prev) => (prev === key ? prev : key))
    },
    [draggingRowId]
  )

  const handleDayDragLeave = useCallback(
    (key: string) => () => {
      setHoverDayKey((prev) => (prev === key ? null : prev))
    },
    []
  )

  const handleDayDrop = useCallback(
    (key: string) => async (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setHoverDayKey(null)
      if (!dateColumn || !dateColumnType) return

      // Prefer the rowId from the active drag state (always available from
      // dragstart), with dataTransfer as a fallback in case state hasn't
      // propagated through React yet.
      const rowId = draggingRowId ?? e.dataTransfer.getData(ROW_DRAG_MIME)
      if (!rowId) return

      const row = rows.find((r) => r.id === rowId)
      if (!row) return

      const next = computeCalendarDropValue(dateColumnType, row.yamlData[dateColumn.name], key)
      if (next === null) return
      await updateCell(rowId, dateColumn.name, next)
    },
    [dateColumn, dateColumnType, draggingRowId, rows, updateCell]
  )

  const goToPreviousMonth = useCallback(() => {
    setCurrentMonth((m) => subMonths(m, 1))
  }, [])

  const goToNextMonth = useCallback(() => {
    setCurrentMonth((m) => addMonths(m, 1))
  }, [])

  const goToToday = useCallback(() => {
    setCurrentMonth(startOfMonth(new Date()))
  }, [])

  // No date column — show setup prompt with CTA to add a Date column.
  if (!dateColumn) {
    return (
      <EmptyViewState
        icon={<Calendar className="w-10 h-10" />}
        title="Calendar View"
        description="Add a Date column to enable Calendar view"
        actionLabel="Add Date Column"
        onAction={async () => {
          if (!meta) return
          const newCol: DatabaseColumnSchema = {
            id: crypto.randomUUID(),
            name: 'Date',
            type: 'date',
            order: meta.schema.length
          }
          await updateSchema([...meta.schema, newCol])
        }}
      />
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {error && <p role="alert" className="px-4 py-1 text-xs text-red-500">{error}</p>}
      {/* Header: month nav on the left, date-column selector + row count on the right. */}
      <div className="flex items-center justify-between px-4 py-2 shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={goToPreviousMonth}
            className="w-7 h-7 flex items-center justify-center rounded-md text-muted-text hover:text-neutral-ink hover:bg-surface-overlay transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <h2 className="text-sm font-semibold text-neutral-ink min-w-[140px] text-center">
            {format(currentMonth, 'MMMM yyyy')}
          </h2>
          <button
            onClick={goToNextMonth}
            className="w-7 h-7 flex items-center justify-center rounded-md text-muted-text hover:text-neutral-ink hover:bg-surface-overlay transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={goToToday}
            className="ml-2 px-2 py-1 text-xs font-medium text-muted-text hover:text-neutral-ink hover:bg-surface-overlay rounded-md transition-colors"
          >
            Today
          </button>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-text">
          <DateColumnSelector
            columns={dateColumnCandidates}
            currentColumnId={dateColumn.id}
            onChange={handleChangeDateColumn}
          />
          <span>
            {visibleRows.length}
            {visibleRows.length !== rows.length && (
              <span className="opacity-60"> of {rows.length}</span>
            )}{' '}
            rows
          </span>
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

      {/* Calendar Grid */}
      <div className="flex-1 overflow-auto px-3 pb-3">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 gap-px mb-px">
          {WEEKDAY_LABELS.map((day) => (
            <div key={day} className="text-center text-xs font-medium text-muted-text py-1.5">
              {day}
            </div>
          ))}
        </div>

        {/* Weeks */}
        <div className="space-y-px">
          {weekLayouts.map((week, wi) => {
            const weekHeight = Math.max(
              MIN_WEEK_HEIGHT,
              DAY_HEADER_HEIGHT + week.lanesUsed * (BAR_HEIGHT + BAR_GAP) + BAR_GAP
            )

            return (
              <div
                key={wi}
                className="grid grid-cols-7 gap-px relative"
                style={{ minHeight: weekHeight, gridAutoRows: '1fr' }}
              >
                {/* Day cells (background, day number, drop target) */}
                {week.days.map((day) => {
                  const key = format(day, 'yyyy-MM-dd')
                  const inMonth = isSameMonth(day, currentMonth)
                  const today = isToday(day)
                  const isHoverTarget = hoverDayKey === key
                  const dow = day.getDay()
                  const isWeekend = dow === 0 || dow === 6
                  return (
                    <div
                      key={key}
                      onDragOver={handleDayDragOver(key)}
                      onDragLeave={handleDayDragLeave(key)}
                      onDrop={(e) => void handleDayDrop(key)(e)}
                      className={cn(
                        'rounded-md border border-transparent transition-colors group',
                        !inMonth && 'bg-warm-vellum/40',
                        inMonth && !isWeekend && 'bg-surface',
                        inMonth && isWeekend && 'bg-black/[0.05] dark:bg-white/[0.05]',
                        'hover:border-border-default/50',
                        isHoverTarget && 'border-maek-red bg-maek-red/5'
                      )}
                    >
                      <div className="flex items-center justify-between px-1 pt-1">
                        <span
                          className={cn(
                            'text-xs font-medium w-5 h-5 flex items-center justify-center rounded-full',
                            today && 'bg-maek-red text-white',
                            !today && inMonth && 'text-neutral-ink',
                            !today && !inMonth && 'text-muted-text/40'
                          )}
                        >
                          {format(day, 'd')}
                        </span>
                        <button
                          onClick={() => void handleDayClick(day)}
                          className="w-4 h-4 flex items-center justify-center rounded text-muted-text hover:text-neutral-ink opacity-0 group-hover:opacity-100 transition-opacity"
                          aria-label="Add row"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )
                })}

                {/* Event overlay: bars span days within the week, stacked by lane.
                    The overlay itself ignores pointer events; only the bars
                    (and the day cells underneath) are interactive. While a drag
                    is in flight, all bars become pointer-events:none so the
                    cell underneath the cursor can receive dragover. */}
                <div
                  className="absolute inset-x-0 pointer-events-none"
                  style={{ top: DAY_HEADER_HEIGHT }}
                >
                  {week.segments.map((seg) => {
                    const title = seg.row.fileName.replace(/\.md$/, '')
                    const isDragging = draggingRowId === seg.row.id
                    const span = seg.endDayIdx - seg.startDayIdx + 1
                    // Source bar must stay interactive so dragend reliably fires
                    // on it; other bars become transparent so cells underneath
                    // receive dragover during a drag.
                    const interactive = draggingRowId === null || isDragging
                    return (
                      <div
                        key={`${seg.row.id}-${wi}`}
                        role="button"
                        tabIndex={0}
                        draggable
                        onDragStart={handleChipDragStart(seg.row)}
                        onDragEnd={handleChipDragEnd}
                        onClick={() => handleRowClick(seg.row)}
                        onContextMenu={openRowContextMenu(seg.row.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            handleRowClick(seg.row)
                          }
                        }}
                        className={cn(
                          'absolute text-left text-[11px] leading-tight px-2 truncate flex items-center cursor-grab active:cursor-grabbing transition-colors shadow-sm select-none',
                          'bg-maek-red text-white hover:bg-maek-red/90',
                          seg.isStart ? 'rounded-l-md' : 'rounded-l-none',
                          seg.isEnd ? 'rounded-r-md' : 'rounded-r-none',
                          isDragging && 'opacity-40',
                          interactive ? 'pointer-events-auto' : 'pointer-events-none'
                        )}
                        style={{
                          left: `calc(${(seg.startDayIdx / 7) * 100}% + 2px)`,
                          width: `calc(${(span / 7) * 100}% - 4px)`,
                          top: seg.lane * (BAR_HEIGHT + BAR_GAP),
                          height: BAR_HEIGHT
                        }}
                        title={title}
                      >
                        <span className="truncate pointer-events-none">
                          {seg.isStart ? title : '↪ ' + title}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Unscheduled rows */}
        {unscheduled.length > 0 && (
          <div className="mt-3 pt-3 border-t border-default">
            <p className="text-xs font-medium text-muted-text mb-1.5">
              Unscheduled ({unscheduled.length})
            </p>
            <div className="flex flex-wrap gap-1">
              {unscheduled.map((row) => {
                const title = row.fileName.replace(/\.md$/, '')
                const isDragging = draggingRowId === row.id
                return (
                  <div
                    key={row.id}
                    role="button"
                    tabIndex={0}
                    draggable
                    onDragStart={handleChipDragStart(row)}
                    onDragEnd={handleChipDragEnd}
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
      </div>

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
