// KanbanBoard — DnD orchestrator.
//
// Single DragDropContext whose only drag type is cards. Lanes are laid out as
// plain flex children (no Droppable wrapper for lane reorder). Each lane owns
// its own vertical card Droppable.

import { useCallback, useMemo, useState, type MouseEvent, type ReactElement } from 'react'
import { Plus } from 'lucide-react'
import { DragDropContext, type DropResult, type OnDragStartResponder } from '@hello-pangea/dnd'
import type { DatabaseColumnSchema, DatabaseRow } from '@shared/database'
import { UNCATEGORIZED } from './constants'
import type { KanbanLane as KanbanLaneModel } from './types'
import { KanbanLane } from './KanbanLane'

interface KanbanBoardProps {
  laneOptions: string[]
  lanesByKey: Map<string, DatabaseRow[]>
  previewColumns: DatabaseColumnSchema[]
  laneColors: Record<string, string>
  onDragStart: OnDragStartResponder
  onDragEnd: (result: DropResult) => void
  onAddCard: (laneKey: string) => void
  onAddLane: () => void
  onOpenAsPage: (row: DatabaseRow) => void
  onOpenInPopup: (row: DatabaseRow) => void
  onLaneColorChange: (laneKey: string, colorKey: string) => void
  onMoveLane: (laneKey: string, direction: 'left' | 'right') => void
  onDeleteLane: (laneKey: string) => void
  onCardContextMenu?: (rowId: string) => (e: MouseEvent) => void
  onUpdateCell?: (rowId: string, columnName: string, value: unknown) => void
  onAddColumnOption?: (columnId: string, newOption: string) => void
  onRenameRow?: (rowId: string, newTitle: string) => void
}

export function KanbanBoard({
  laneOptions,
  lanesByKey,
  previewColumns,
  laneColors,
  onDragStart,
  onDragEnd,
  onAddCard,
  onAddLane,
  onOpenAsPage,
  onOpenInPopup,
  onLaneColorChange,
  onMoveLane,
  onDeleteLane,
  onCardContextMenu,
  onUpdateCell,
  onAddColumnOption,
  onRenameRow
}: KanbanBoardProps): ReactElement {
  // Single source of truth: only one card may have an inline editor open at a
  // time across the whole board. The active row's <Draggable> gets
  // isDragDisabled so a click-into-edit doesn't initiate a drag.
  const [editingRowId, setEditingRowId] = useState<string | null>(null)
  const handleCardEditingChange = useCallback((rowId: string, isEditing: boolean) => {
    setEditingRowId((prev) => {
      if (isEditing) return rowId
      return prev === rowId ? null : prev
    })
  }, [])

  const optionLanes = useMemo<KanbanLaneModel[]>(
    () =>
      laneOptions.map((key) => ({
        key,
        label: key,
        rows: lanesByKey.get(key) ?? []
      })),
    [laneOptions, lanesByKey]
  )
  const uncategorizedRows = lanesByKey.get(UNCATEGORIZED) ?? []

  return (
    <DragDropContext
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      // Disable the library's auto-scroller — our outer wrapper has
      // `overflow-x-auto` (needed for horizontal lane scroll), which the
      // library's getClosestScrollable would otherwise pick up as a drag
      // auto-scroll target and scroll horizontally when the cursor nears a
      // lane's right edge. That scrollLeft change is retained post-drop,
      // which visually looks like cards stuck shifted leftward.
      autoScrollerOptions={{ disabled: true }}
    >
      <div className="flex-1 overflow-x-auto overflow-y-hidden px-3 pb-3">
        <div className="flex gap-3 h-full items-stretch">
          {optionLanes.map((lane, idx) => (
            <KanbanLane
              key={lane.key}
              laneKey={lane.key}
              label={lane.label}
              rows={lane.rows}
              previewColumns={previewColumns}
              colorKey={laneColors[lane.key]}
              laneIndex={idx}
              laneCount={optionLanes.length}
              editingRowId={editingRowId}
              onAddCard={onAddCard}
              onOpenAsPage={onOpenAsPage}
              onOpenInPopup={onOpenInPopup}
              onColorChange={onLaneColorChange}
              onMoveLane={onMoveLane}
              onDeleteLane={onDeleteLane}
              onCardContextMenu={onCardContextMenu}
              onUpdateCell={onUpdateCell}
              onAddColumnOption={onAddColumnOption}
              onRenameRow={onRenameRow}
              onCardEditingChange={handleCardEditingChange}
            />
          ))}

          <KanbanLane
            laneKey={UNCATEGORIZED}
            label="No Value"
            rows={uncategorizedRows}
            previewColumns={previewColumns}
            colorKey={laneColors[UNCATEGORIZED]}
            laneIndex={-1}
            laneCount={optionLanes.length}
            editingRowId={editingRowId}
            onAddCard={onAddCard}
            onOpenAsPage={onOpenAsPage}
            onOpenInPopup={onOpenInPopup}
            onColorChange={onLaneColorChange}
            onMoveLane={onMoveLane}
            onDeleteLane={onDeleteLane}
            onCardContextMenu={onCardContextMenu}
            onUpdateCell={onUpdateCell}
            onAddColumnOption={onAddColumnOption}
            onRenameRow={onRenameRow}
            onCardEditingChange={handleCardEditingChange}
          />

          <div className="flex items-start pt-2.5 shrink-0">
            <button
              type="button"
              onClick={onAddLane}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-text hover:text-neutral-ink hover:bg-surface-overlay transition-colors whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Lane
            </button>
          </div>
        </div>
      </div>
    </DragDropContext>
  )
}
