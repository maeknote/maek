// KanbanLane — one vertical lane on the board. Lanes are not draggable.
//
// Structure:
//   header (label + color menu)
//   Droppable (card list, vertical)
//     Draggable (cards)
//   Add Card button

import { type MouseEvent, type ReactElement } from 'react'
import { Plus } from 'lucide-react'
import { Draggable, Droppable } from '@hello-pangea/dnd'
import type { DatabaseColumnSchema, DatabaseRow } from '@shared/database'
import { cn } from '@renderer/lib/utils'
import { DRAG_TYPE_CARD, UNCATEGORIZED, getColorPreset, laneDroppableId } from './constants'
import { KanbanCard } from './KanbanCard'
import { LaneColorMenu } from './LaneColorMenu'

interface KanbanLaneProps {
  laneKey: string
  label: string
  rows: DatabaseRow[]
  previewColumns: DatabaseColumnSchema[]
  colorKey: string | undefined
  /** Position among the option lanes (excluding UNCATEGORIZED). -1 for UNCATEGORIZED. */
  laneIndex: number
  /** Total count of option lanes (excluding UNCATEGORIZED). */
  laneCount: number
  /** Row id whose card currently has an inline editor open (drag disabled). */
  editingRowId: string | null
  onAddCard: (laneKey: string) => void
  onOpenAsPage: (row: DatabaseRow) => void
  onOpenInPopup: (row: DatabaseRow) => void
  onColorChange: (laneKey: string, colorKey: string) => void
  onMoveLane: (laneKey: string, direction: 'left' | 'right') => void
  onDeleteLane: (laneKey: string) => void
  onCardContextMenu?: (rowId: string) => (e: MouseEvent) => void
  onUpdateCell?: (rowId: string, columnName: string, value: unknown) => Promise<void>
  onAddColumnOption?: (columnId: string, newOption: string) => Promise<void>
  onRenameRow?: (rowId: string, newTitle: string) => void
  onCardEditingChange?: (rowId: string, isEditing: boolean) => void
}

export function KanbanLane({
  laneKey,
  label,
  rows,
  previewColumns,
  colorKey,
  laneIndex,
  laneCount,
  editingRowId,
  onAddCard,
  onOpenAsPage,
  onOpenInPopup,
  onColorChange,
  onMoveLane,
  onDeleteLane,
  onCardContextMenu,
  onUpdateCell,
  onAddColumnOption,
  onRenameRow,
  onCardEditingChange
}: KanbanLaneProps): ReactElement {
  const color = getColorPreset(colorKey)
  const canCustomize = laneKey !== UNCATEGORIZED
  const canMoveLeft = canCustomize && laneIndex > 0
  const canMoveRight = canCustomize && laneIndex >= 0 && laneIndex < laneCount - 1

  return (
    <div
      className={cn(
        'flex flex-col rounded-xl min-w-[272px] w-[272px] max-w-[272px] max-h-full shrink-0',
        color.bg || 'bg-[var(--color-surface-secondary,rgba(0,0,0,0.03))]'
      )}
    >
      <div className="group/header relative flex flex-col items-center shrink-0">
        {canCustomize && (
          <LaneColorMenu
            selectedKey={colorKey}
            onChange={(next) => onColorChange(laneKey, next)}
            canMoveLeft={canMoveLeft}
            canMoveRight={canMoveRight}
            onMoveLeft={() => onMoveLane(laneKey, 'left')}
            onMoveRight={() => onMoveLane(laneKey, 'right')}
            onDelete={() => onDeleteLane(laneKey)}
          />
        )}
        <div className="flex items-center gap-1.5 px-3 py-2 w-full select-none">
          <span className="text-xs font-semibold text-neutral-ink truncate">{label}</span>
          <span className="text-xs text-muted-text">{rows.length}</span>
        </div>
      </div>

      {/* Scroll container is OUTSIDE the Droppable so the drag-hit area maps
          only to the card stack, not the lane's whole vertical empty space. */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-2">
        <Droppable
          droppableId={laneDroppableId(laneKey)}
          type={DRAG_TYPE_CARD}
          direction="vertical"
          renderClone={(cloneProvided, cloneSnapshot, rubric) => {
            // The dragged card is rendered via React Portal at document.body
            // (independent of list layout). This prevents cursor X excursions
            // from leaking into the destination lane's sibling transforms.
            const sourceRow =
              rows.find((r) => r.id === rubric.draggableId) ?? rows[rubric.source.index]
            if (!sourceRow) {
              return <div ref={cloneProvided.innerRef} {...cloneProvided.draggableProps} />
            }
            return (
              <KanbanCard
                row={sourceRow}
                previewColumns={previewColumns}
                provided={cloneProvided}
                snapshot={cloneSnapshot}
                onOpenAsPage={onOpenAsPage}
                onOpenInPopup={onOpenInPopup}
              />
            )
          }}
        >
          {(dropProvided) => (
            // min-h-full ensures an empty lane (especially No Value) still
            // covers the lane's full vertical area so drops can't slip past
            // the small placeholder when there are zero cards.
            <div
              ref={dropProvided.innerRef}
              {...dropProvided.droppableProps}
              className="space-y-1.5 min-h-full"
            >
              {rows.map((row, idx) => (
                <Draggable
                  key={row.id}
                  draggableId={row.id}
                  index={idx}
                  isDragDisabled={editingRowId === row.id}
                >
                  {(cardProvided, cardSnapshot) => (
                    <KanbanCard
                      row={row}
                      previewColumns={previewColumns}
                      provided={cardProvided}
                      snapshot={cardSnapshot}
                      onOpenAsPage={onOpenAsPage}
                      onOpenInPopup={onOpenInPopup}
                      onContextMenu={onCardContextMenu?.(row.id)}
                      onUpdateCell={onUpdateCell}
                      onAddColumnOption={onAddColumnOption}
                      onRenameRow={onRenameRow}
                      onEditingChange={onCardEditingChange}
                    />
                  )}
                </Draggable>
              ))}
              {dropProvided.placeholder}
            </div>
          )}
        </Droppable>
      </div>

      <div className="shrink-0 px-2 pb-2">
        <button
          type="button"
          onClick={() => onAddCard(laneKey)}
          className="flex items-center gap-1.5 w-full px-3 py-1.5 rounded-lg text-xs text-muted-text hover:text-neutral-ink hover:bg-surface-overlay transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New
        </button>
      </div>
    </div>
  )
}
