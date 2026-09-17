import { useCallback } from "react";
import { Plus } from "lucide-react";
import type { Editor } from "@tiptap/react";
import { addRowToTable, addColumnToTable } from "../../extensions/table";

interface TableAddButtonsProps {
  editor: Editor;
  tablePos: number;
  tableWidth: number;
  tableHeight: number;
}

/**
 * Add row/column buttons with edge hover zones
 * - Bottom edge zone: triggers add row button visibility
 * - Right edge zone: triggers add column button visibility
 */
export function TableAddButtons({
  editor,
  tablePos,
  tableWidth,
  tableHeight,
}: TableAddButtonsProps) {
  const handleAddRow = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      addRowToTable(editor, tablePos);
    },
    [editor, tablePos],
  );

  const handleAddColumn = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      addColumnToTable(editor, tablePos);
    },
    [editor, tablePos],
  );

  return (
    <>
      {/* Bottom edge zone (add row) */}
      <div
        className="table-edge-zone table-edge-zone-bottom"
        style={{ width: tableWidth }}
      >
        <button
          type="button"
          className="table-add-btn"
          onClick={handleAddRow}
          aria-label="Add row"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Right edge zone (add column) */}
      <div
        className="table-edge-zone table-edge-zone-right"
        style={{ height: tableHeight }}
      >
        <button
          type="button"
          className="table-add-btn"
          onClick={handleAddColumn}
          aria-label="Add column"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </>
  );
}
