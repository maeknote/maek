import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { RowGrip } from "./RowGrip";
import { ColumnGrip } from "./ColumnGrip";
import { TableAddButtons } from "./TableAddButtons";
import { TableContextMenu } from "./TableContextMenu";
import { useTableStore } from "../../stores/tableStore";
import { executeTableAction } from "../../extensions/table";
import type { RowGripData, ColumnGripData, TableMenuAction } from "../../types";

interface TableOverlayProps {
  editor: Editor | null;
}

interface TableData {
  tableEl: HTMLTableElement;
  tablePos: number;
  rows: RowGripData[];
  columns: ColumnGripData[];
  rect: DOMRect;
}

export function TableOverlay({ editor }: TableOverlayProps) {
  const [tables, setTables] = useState<TableData[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    menuOpen,
    menuType,
    menuPosition,
    menuTargetIndex,
    activeTablePos,
    gripsVisible,
    gripsTablePos,
    gripsRowIndex,
    gripsColIndex,
    openMenu,
    closeMenu,
    showGrips,
    hideGrips,
  } = useTableStore();

  // Calculate table positions and grip positions
  const updateTableData = useCallback(() => {
    if (!editor || !editor.view) return;

    const editorEl = editor.view.dom;
    const tableEls = editorEl.querySelectorAll("table.maek-table");
    const newTables: TableData[] = [];

    tableEls.forEach((tableEl) => {
      const table = tableEl as HTMLTableElement;
      const rect = table.getBoundingClientRect();

      // Get table position in ProseMirror document
      let tablePos = -1;
      editor.state.doc.descendants((node, pos): boolean => {
        if (node.type.name === "table") {
          const domNode = editor.view.nodeDOM(pos);
          if (domNode && (domNode as HTMLElement).contains(table)) {
            tablePos = pos;
            return false;
          }
        }
        return true;
      });

      if (tablePos === -1) return;

      // Calculate row grips
      const rows: RowGripData[] = [];
      const rowEls = table.querySelectorAll("tr");
      rowEls.forEach((rowEl, index) => {
        const rowRect = rowEl.getBoundingClientRect();
        rows.push({
          rowIndex: index,
          isHeader: index === 0,
          top: rowRect.top - rect.top,
          height: rowRect.height,
        });
      });

      // Calculate column grips from first row cells
      const columns: ColumnGripData[] = [];
      const firstRow = table.querySelector("tr");
      if (firstRow) {
        const cells = firstRow.querySelectorAll("th, td");
        cells.forEach((cell, index) => {
          const cellRect = cell.getBoundingClientRect();
          columns.push({
            colIndex: index,
            left: cellRect.left - rect.left,
            width: cellRect.width,
          });
        });
      }

      newTables.push({
        tableEl: table,
        tablePos,
        rows,
        columns,
        rect,
      });
    });

    setTables(newTables);
  }, [editor]);

  // Update on editor changes
  useEffect(() => {
    if (!editor) return;

    updateTableData();

    // Listen for editor updates
    editor.on("update", updateTableData);
    editor.on("selectionUpdate", updateTableData);

    // Also update on scroll/resize
    const handleScrollResize = () => {
      requestAnimationFrame(updateTableData);
    };

    window.addEventListener("scroll", handleScrollResize, true);
    window.addEventListener("resize", handleScrollResize);

    return () => {
      editor.off("update", updateTableData);
      editor.off("selectionUpdate", updateTableData);
      window.removeEventListener("scroll", handleScrollResize, true);
      window.removeEventListener("resize", handleScrollResize);
    };
  }, [editor, updateTableData]);

  // Handle row menu open
  const handleRowMenuOpen = useCallback(
    (tablePos: number) =>
      (rowIndex: number, position: { x: number; y: number }) => {
        openMenu("row", rowIndex, position, tablePos);
      },
    [openMenu],
  );

  // Handle column menu open
  const handleColumnMenuOpen = useCallback(
    (tablePos: number) =>
      (colIndex: number, position: { x: number; y: number }) => {
        openMenu("column", colIndex, position, tablePos);
      },
    [openMenu],
  );

  // Handle menu action
  const handleMenuAction = useCallback(
    (action: TableMenuAction) => {
      if (!editor || menuTargetIndex === null) return;
      executeTableAction(editor, action, menuTargetIndex);
      closeMenu();
    },
    [editor, menuTargetIndex, closeMenu],
  );

  // Handle double-click on cell to show grips
  useEffect(() => {
    const handleDoubleClick = (e: MouseEvent) => {
      const cell = (e.target as HTMLElement).closest("td, th");
      if (cell) {
        const table = cell.closest("table.maek-table") as HTMLTableElement;
        if (table && editor) {
          // Find the tablePos for this table
          const tableData = tables.find((t) => t.tableEl === table);
          if (tableData) {
            // Get the row containing this cell
            const row = cell.closest("tr");
            if (row) {
              const rowIndex = Array.from(table.querySelectorAll("tr")).indexOf(
                row,
              );
              const colIndex = Array.from(row.children).indexOf(cell);
              showGrips(tableData.tablePos, rowIndex, colIndex);
            }
          }
        }
      }
    };

    document.addEventListener("dblclick", handleDoubleClick);
    return () => document.removeEventListener("dblclick", handleDoubleClick);
  }, [editor, tables, showGrips]);

  // Handle click outside to hide grips
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const table = target.closest("table.maek-table");
      const gripContainer = target.closest(".maek-table-grip-container");
      const contextMenu = target.closest(".maek-table-context-menu");
      const edgeZone = target.closest(".edge-zone");

      // Don't hide if clicking on table, grips, menu, or edge zones
      if (!table && !gripContainer && !contextMenu && !edgeZone) {
        hideGrips();
      }
    };

    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [hideGrips]);

  if (tables.length === 0) return null;

  return (
    <>
      {tables.map((tableData) => {
        const isGripsVisible =
          (gripsVisible && gripsTablePos === tableData.tablePos) ||
          (menuOpen && activeTablePos === tableData.tablePos);

        return createPortal(
          <div
            key={tableData.tablePos}
            ref={containerRef}
            className={`maek-table-grip-container ${isGripsVisible ? "visible" : ""}`}
            style={{
              position: "absolute",
              top: tableData.rect.top + window.scrollY,
              left: tableData.rect.left + window.scrollX,
              width: tableData.rect.width,
              height: tableData.rect.height,
              pointerEvents: "none",
            }}
          >
            {/* Row Grip (only for the specific row when grips are visible) */}
            {isGripsVisible &&
              tableData.rows
                .filter((row) => row.rowIndex === gripsRowIndex)
                .map((row) => (
                  <RowGrip
                    key={`row-${row.rowIndex}`}
                    rowIndex={row.rowIndex}
                    isHeader={row.isHeader}
                    top={row.top}
                    height={row.height}
                    onMenuOpen={handleRowMenuOpen(tableData.tablePos)}
                  />
                ))}

            {/* Column Grip (only for the specific column when grips are visible) */}
            {isGripsVisible &&
              tableData.columns
                .filter((col) => col.colIndex === gripsColIndex)
                .map((col) => (
                  <ColumnGrip
                    key={`col-${col.colIndex}`}
                    colIndex={col.colIndex}
                    left={col.left}
                    width={col.width}
                    onMenuOpen={handleColumnMenuOpen(tableData.tablePos)}
                  />
                ))}
          </div>,
          document.body,
        );
      })}

      {/* Add Buttons - separate portal (always visible container) */}
      {tables.map((tableData) =>
        createPortal(
          <div
            key={`add-btns-${tableData.tablePos}`}
            className="table-add-buttons-container"
            style={{
              position: "absolute",
              top: tableData.rect.top + window.scrollY,
              left: tableData.rect.left + window.scrollX,
              width: tableData.rect.width,
              height: tableData.rect.height,
              pointerEvents: "none",
            }}
          >
            {editor && (
              <TableAddButtons
                editor={editor}
                tablePos={tableData.tablePos}
                tableWidth={tableData.rect.width}
                tableHeight={tableData.rect.height}
              />
            )}
          </div>,
          document.body,
        ),
      )}

      {/* Context Menu */}
      {menuOpen && menuType && menuPosition && menuTargetIndex !== null && (
        <TableContextMenu
          type={menuType}
          position={menuPosition}
          targetIndex={menuTargetIndex}
          onAction={handleMenuAction}
          onClose={closeMenu}
          isHeader={menuType === "row" && menuTargetIndex === 0}
        />
      )}
    </>
  );
}
