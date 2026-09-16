// ViewFilterSortToolbar - Top-of-view toolbar that exposes filter and sort
// entry points for non-table views (kanban, calendar, timeline).
//
// The table view surfaces filter/sort inside each column-header dropdown
// (`ColumnHeaderMenu`). Non-table views have no column-header UI, so this
// toolbar provides Notion-style "+ Filter" and "+ Sort" buttons that open
// column pickers.
//
// Filter flow:
//   · Click "Filter" → picker lists columns.
//   · Click a column → nested FilterEditor flyout opens to the right.
//   · Clicking another column swaps the flyout target; clicking outside both
//     popovers (or pressing Esc) closes them.
//
// Sort flow:
//   · Click "Sort" → picker shows Active sorts (drag-to-reorder with asc/desc
//     toggles and a remove button) then Add sort (inactive columns).
//   · Clicking direction buttons updates / toggles the rule but keeps the
//     menu open — multi-sort is expected.
//   · Menu closes via outside click or Esc. Active rules apply top-down.
//
// Active rules render below as chips via the existing `ViewStateChipBar`.

import { useCallback, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import {
  DragDropContext,
  Draggable,
  Droppable,
  type DraggableProvided,
  type DraggableStateSnapshot,
  type DropResult
} from '@hello-pangea/dnd'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronRight,
  Filter as FilterIcon,
  GripVertical,
  X
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { FloatingMenu, type FloatingMenuPosition } from '@renderer/shared/components'
import type {
  DatabaseColumnSchema,
  DatabaseFilterCondition,
  DatabaseSortRule,
  DatabaseViewState,
  SortDirection
} from '@shared/database'
import { FilterEditor } from './FilterEditor'
import { FilterChip, SortChip } from './ViewStateChipBar'
import { defaultOperatorForType } from '../utils/filterOperators'
import { TITLE_SORT_COLUMN_ID, createTitleSortColumn } from '../utils/rowSort'

interface ViewFilterSortToolbarProps {
  columns: DatabaseColumnSchema[]
  viewState: DatabaseViewState
  onSetFilter: (condition: DatabaseFilterCondition) => void
  onClearFilter: (columnId: string) => void
  /**
   * Add, update direction, or remove a single rule. Implementations should
   * preserve the existing rule's position when updating direction and append
   * when adding a new one — the menu's drag handle is the only way to change
   * priority.
   */
  onSetSort: (columnId: string, direction: SortDirection | null) => void
  /** Replace the entire sort rules array (used by drag-to-reorder). */
  onReorderSort: (rules: DatabaseSortRule[]) => void
  onClearAll: () => void
  /** Extra content rendered before the filter/sort buttons (e.g., date-column selector). */
  leading?: ReactElement | null
  /** Extra content rendered at the end (e.g., view-specific controls). */
  trailing?: ReactElement | null
}

// Distinct DnD type token so the sort-rule drag never cross-targets the
// select-options list (SelectOptionsReorderList uses 'select-option').
const DRAG_TYPE_SORT_RULE = 'view-sort-rule'

export function ViewFilterSortToolbar({
  columns,
  viewState,
  onSetFilter,
  onClearFilter,
  onSetSort,
  onReorderSort,
  onClearAll,
  leading,
  trailing
}: ViewFilterSortToolbarProps): ReactElement {
  // --- Filter picker + click-triggered FilterEditor flyout ---
  const filterButtonRef = useRef<HTMLButtonElement>(null)
  const [filterPickerOpen, setFilterPickerOpen] = useState(false)
  const [filterPickerPos, setFilterPickerPos] = useState<FloatingMenuPosition | null>(null)

  const [activeFilterColumnId, setActiveFilterColumnId] = useState<string | null>(null)
  const [flyoutPos, setFlyoutPos] = useState<FloatingMenuPosition | null>(null)
  const flyoutInnerRef = useRef<HTMLDivElement>(null)

  // Exclude the nested flyout from the parent menu's outside-click dismissal
  // so clicks inside the FilterEditor (operator select, value input, etc.)
  // don't collapse the column list.
  const flyoutExtraDismissRefs = useMemo(() => [flyoutInnerRef], [])

  const openFilterPicker = useCallback(() => {
    if (filterButtonRef.current) {
      const rect = filterButtonRef.current.getBoundingClientRect()
      setFilterPickerPos({ x: rect.left, y: rect.bottom })
    }
    setFilterPickerOpen(true)
  }, [])

  const closeFilterPicker = useCallback(() => {
    setFilterPickerOpen(false)
    setActiveFilterColumnId(null)
  }, [])

  const activeFilterColumn = activeFilterColumnId
    ? (columns.find((c) => c.id === activeFilterColumnId) ?? null)
    : null
  const activeFilterCondition = activeFilterColumn
    ? (viewState.filter.conditions.find((c) => c.columnId === activeFilterColumn.id) ?? null)
    : null

  // --- Sort picker menu (multi-rule, drag-to-reorder, stays open on click) ---
  const sortButtonRef = useRef<HTMLButtonElement>(null)
  const [sortPickerOpen, setSortPickerOpen] = useState(false)
  const [sortPickerPos, setSortPickerPos] = useState<FloatingMenuPosition | null>(null)

  const openSortPicker = useCallback(() => {
    if (sortButtonRef.current) {
      const rect = sortButtonRef.current.getBoundingClientRect()
      setSortPickerPos({ x: rect.left, y: rect.bottom })
    }
    setSortPickerOpen(true)
  }, [])

  // Click on a direction button mutates but does NOT close the menu so the
  // user can layer more rules.
  const toggleSortDirection = useCallback(
    (columnId: string, direction: SortDirection): void => {
      const existing = viewState.sort.find((r) => r.columnId === columnId)
      if (existing?.direction === direction) {
        onSetSort(columnId, null)
      } else {
        onSetSort(columnId, direction)
      }
    },
    [viewState.sort, onSetSort]
  )

  const handleSortDragEnd = useCallback(
    (result: DropResult): void => {
      if (!result.destination) return
      const from = result.source.index
      const to = result.destination.index
      if (from === to) return
      const next = [...viewState.sort]
      const [moved] = next.splice(from, 1)
      if (!moved) return
      next.splice(to, 0, moved)
      onReorderSort(next)
    },
    [viewState.sort, onReorderSort]
  )

  const activeSortRules = viewState.sort
  const activeSortColumnIds = useMemo(
    () => new Set(activeSortRules.map((r) => r.columnId)),
    [activeSortRules]
  )
  // Title is not a real schema column, but it is sortable — prepend a
  // virtual entry so the picker offers it alongside real columns. Filter
  // UI intentionally does NOT include title (title filtering would need
  // its own operator set and is out of scope here).
  const sortableColumns = useMemo<DatabaseColumnSchema[]>(
    () => [createTitleSortColumn(), ...columns],
    [columns]
  )
  const availableSortColumns = useMemo(
    () => sortableColumns.filter((c) => !activeSortColumnIds.has(c.id)),
    [sortableColumns, activeSortColumnIds]
  )

  const hasFilter = viewState.filter.conditions.length > 0
  const hasSort = activeSortRules.length > 0

  // --- Rendered active-sort row (shared with Draggable.renderClone) ---
  const renderActiveSortRow = useCallback(
    (
      rule: DatabaseSortRule,
      column: DatabaseColumnSchema,
      provided: DraggableProvided,
      snapshot: DraggableStateSnapshot
    ): ReactNode => {
      const ascActive = rule.direction === 'asc'
      const descActive = rule.direction === 'desc'
      return (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={cn(
            'flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-neutral-ink',
            'bg-surface-overlay',
            snapshot.isDragging && 'shadow-md ring-1 ring-black/5'
          )}
        >
          <span
            {...provided.dragHandleProps}
            className="flex h-4 w-4 shrink-0 cursor-grab items-center justify-center text-muted-text hover:text-neutral-ink active:cursor-grabbing"
            aria-label={`Reorder sort ${column.name}`}
          >
            <GripVertical className="h-3 w-3" />
          </span>
          <span className="flex-1 truncate">{column.name}</span>
          <button
            type="button"
            onClick={() => toggleSortDirection(column.id, 'asc')}
            className={cn(
              'flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] transition-colors',
              ascActive
                ? 'bg-maek-red/15 text-maek-red'
                : 'text-muted-text hover:bg-surface hover:text-neutral-ink'
            )}
            title={ascActive ? 'Clear ascending sort' : 'Sort ascending'}
            aria-pressed={ascActive}
          >
            <ArrowUp className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => toggleSortDirection(column.id, 'desc')}
            className={cn(
              'flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] transition-colors',
              descActive
                ? 'bg-maek-red/15 text-maek-red'
                : 'text-muted-text hover:bg-surface hover:text-neutral-ink'
            )}
            title={descActive ? 'Clear descending sort' : 'Sort descending'}
            aria-pressed={descActive}
          >
            <ArrowDown className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => onSetSort(column.id, null)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-text hover:bg-red-500/20 hover:text-red-500"
            aria-label={`Remove sort on ${column.name}`}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )
    },
    [toggleSortDirection, onSetSort]
  )

  // Single-row layout: [leading] [chips flex-1 wrap] [Filter] [Sort] [trailing].
  // Chips wrap internally when they exceed the available width; the outer row
  // keeps `items-center` so short chip rows still align on one visual line.
  const columnsById = useMemo(() => {
    const map = new Map<string, DatabaseColumnSchema>()
    // Register the virtual title column first so title-sort chips can
    // resolve even though title isn't a real schema column. Real columns
    // with id collisions (impossible — title uses a sentinel id) would
    // override it.
    map.set(TITLE_SORT_COLUMN_ID, createTitleSortColumn())
    for (const col of columns) map.set(col.id, col)
    return map
  }, [columns])
  const hasAnyActive = hasSort || hasFilter

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-1.5 text-xs text-muted-text shrink-0 min-w-0">
      {leading}

      {hasAnyActive && (
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          {activeSortRules.map((rule) => {
            const col = columnsById.get(rule.columnId)
            if (!col) return null
            return (
              <SortChip
                key={`sort-${rule.columnId}`}
                column={col}
                rule={rule}
                onRemove={() => onSetSort(rule.columnId, null)}
              />
            )
          })}
          {viewState.filter.conditions.map((cond) => {
            const col = columnsById.get(cond.columnId)
            if (!col) return null
            return (
              <FilterChip
                key={`filter-${cond.columnId}`}
                column={col}
                condition={cond}
                onRemove={() => onClearFilter(cond.columnId)}
              />
            )
          })}
          <button
            type="button"
            onClick={onClearAll}
            className="rounded-md px-2 py-0.5 text-[10px] font-medium text-muted-text hover:bg-surface-overlay hover:text-neutral-ink transition-colors"
          >
            Clear all
          </button>
        </div>
      )}

      <div className="ml-auto flex items-center gap-1 shrink-0">
        <button
          ref={filterButtonRef}
          type="button"
          onClick={() => (filterPickerOpen ? closeFilterPicker() : openFilterPicker())}
          className={cn(
            'flex items-center gap-1 px-2 py-0.5 rounded-md hover:bg-surface-overlay transition-colors',
            hasFilter && 'text-neutral-ink'
          )}
        >
          <FilterIcon className="w-3 h-3" />
          <span>Filter</span>
          {hasFilter && (
            <span className="text-[10px] opacity-70">({viewState.filter.conditions.length})</span>
          )}
        </button>
        <button
          ref={sortButtonRef}
          type="button"
          onClick={() => (sortPickerOpen ? setSortPickerOpen(false) : openSortPicker())}
          className={cn(
            'flex items-center gap-1 px-2 py-0.5 rounded-md hover:bg-surface-overlay transition-colors',
            hasSort && 'text-neutral-ink'
          )}
        >
          <ArrowUpDown className="w-3 h-3" />
          <span>Sort</span>
          {hasSort && <span className="text-[10px] opacity-70">({activeSortRules.length})</span>}
        </button>
        {trailing}
      </div>

      {/* Filter column list (parent menu) */}
      <FloatingMenu
        isOpen={filterPickerOpen}
        position={filterPickerPos}
        onClose={closeFilterPicker}
        anchorRef={filterButtonRef}
        extraDismissRefs={flyoutExtraDismissRefs}
        minWidth={200}
      >
        {columns.length === 0 ? (
          <div className="px-3 py-2 text-[11px] text-muted-text">No columns</div>
        ) : (
          <>
            <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-text">
              Filter by column
            </div>
            {columns.map((col) => {
              const hasExisting = viewState.filter.conditions.some((c) => c.columnId === col.id)
              const isActive = activeFilterColumnId === col.id
              return (
                <button
                  key={col.id}
                  type="button"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect()
                    setFlyoutPos({ x: rect.right + 4, y: rect.top })
                    setActiveFilterColumnId(col.id)
                  }}
                  className={cn(
                    'w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs transition-colors',
                    isActive
                      ? 'text-neutral-ink bg-surface-overlay'
                      : 'text-muted-text hover:text-neutral-ink hover:bg-surface-overlay'
                  )}
                >
                  <span className="flex-1 truncate">{col.name}</span>
                  {hasExisting && <span className="text-[10px] text-neutral-ink">●</span>}
                  <ChevronRight className="w-3 h-3 opacity-60" />
                </button>
              )
            })}
          </>
        )}
      </FloatingMenu>

      {/* Nested flyout: FilterEditor for the column the user clicked on */}
      {filterPickerOpen && activeFilterColumn && (
        <FloatingMenu
          isOpen={true}
          position={flyoutPos}
          onClose={() => setActiveFilterColumnId(null)}
          minWidth={280}
        >
          <div ref={flyoutInnerRef}>
            <FilterEditor
              key={activeFilterColumn.id}
              column={activeFilterColumn}
              condition={activeFilterCondition}
              onChange={(next) => {
                onSetFilter(
                  activeFilterCondition
                    ? next
                    : {
                        ...next,
                        operator: next.operator ?? defaultOperatorForType(activeFilterColumn.type)
                      }
                )
              }}
              onDone={() => setActiveFilterColumnId(null)}
              onRemove={
                activeFilterCondition
                  ? () => {
                      onClearFilter(activeFilterColumn.id)
                      setActiveFilterColumnId(null)
                    }
                  : undefined
              }
            />
          </div>
        </FloatingMenu>
      )}

      {/* Sort picker: active (draggable) on top, available below */}
      <FloatingMenu
        isOpen={sortPickerOpen}
        position={sortPickerPos}
        onClose={() => setSortPickerOpen(false)}
        anchorRef={sortButtonRef}
        minWidth={260}
      >
        {sortableColumns.length === 0 ? (
          <div className="px-3 py-2 text-[11px] text-muted-text">No columns</div>
        ) : (
          <div className="py-1.5">
            {activeSortRules.length > 0 && (
              <>
                <div className="flex items-center justify-between px-3 pb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-text">
                    Active sorts ({activeSortRules.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => onReorderSort([])}
                    className="text-[10px] text-muted-text hover:text-red-500"
                  >
                    Clear
                  </button>
                </div>
                <DragDropContext onDragEnd={handleSortDragEnd}>
                  <Droppable
                    droppableId="view-sort-rules"
                    type={DRAG_TYPE_SORT_RULE}
                    renderClone={(provided, snapshot, rubric) => {
                      const rule = activeSortRules[rubric.source.index]
                      if (!rule) return <div ref={provided.innerRef} {...provided.draggableProps} />
                      const col = sortableColumns.find((c) => c.id === rule.columnId)
                      if (!col) return <div ref={provided.innerRef} {...provided.draggableProps} />
                      return renderActiveSortRow(rule, col, provided, snapshot)
                    }}
                  >
                    {(dropProvided) => (
                      <div
                        ref={dropProvided.innerRef}
                        {...dropProvided.droppableProps}
                        className="flex flex-col gap-1 px-2"
                      >
                        {activeSortRules.map((rule, idx) => {
                          const col = sortableColumns.find((c) => c.id === rule.columnId)
                          if (!col) return null
                          return (
                            <Draggable
                              key={rule.columnId}
                              draggableId={`sort-${rule.columnId}`}
                              index={idx}
                            >
                              {(dragProvided, dragSnapshot) =>
                                renderActiveSortRow(rule, col, dragProvided, dragSnapshot)
                              }
                            </Draggable>
                          )
                        })}
                        {dropProvided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </DragDropContext>
                <div className="my-1.5 border-t border-default" />
              </>
            )}

            <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-text">
              {activeSortRules.length === 0 ? 'Sort by column' : 'Add sort'}
            </div>
            {availableSortColumns.length === 0 ? (
              <div className="px-3 py-1 text-[11px] text-muted-text">
                All columns are already sorted.
              </div>
            ) : (
              availableSortColumns.map((col) => (
                <div key={col.id} className="px-2 py-0.5">
                  <div className="flex items-center gap-1">
                    <span className="flex-1 px-1 text-xs text-neutral-ink truncate">
                      {col.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => onSetSort(col.id, 'asc')}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-muted-text hover:bg-surface-overlay hover:text-neutral-ink transition-colors"
                      aria-label={`Sort ${col.name} ascending`}
                    >
                      <ArrowUp className="w-3 h-3" />
                      Asc
                    </button>
                    <button
                      type="button"
                      onClick={() => onSetSort(col.id, 'desc')}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-muted-text hover:bg-surface-overlay hover:text-neutral-ink transition-colors"
                      aria-label={`Sort ${col.name} descending`}
                    >
                      <ArrowDown className="w-3 h-3" />
                      Desc
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </FloatingMenu>
    </div>
  )
}
