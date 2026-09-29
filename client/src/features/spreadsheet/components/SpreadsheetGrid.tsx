import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DataGrid,
  type Column,
  type ColumnWidths,
  type DataGridHandle,
  type RenderEditCellProps,
} from "react-data-grid";
import { columnLabel } from "../model";
import {
  buildDisplayRows,
  computeGridShape,
  type DisplayRow,
} from "../coordinates";
import { CSV_LIMITS } from "../model";
import {
  singleSelection,
  selectionContains,
  removeCellFromRanges,
  type SelectionRange,
} from "../selection";
import type { SheetSession } from "../sheet-session";
import { ColumnFilterMenu } from "./ColumnFilterMenu";
import { hasActiveClause } from "../filtering";
import { Filter } from "lucide-react";

interface GridRow {
  key: string;
  documentIndex: number;
  rowNumber: number;
  isHeader: boolean;
}

interface EditCellProps extends RenderEditCellProps<GridRow> {
  getSession: () => SheetSession;
  dataColumn: number;
}

/** Shared cell editor used for both normal and frozen rows. */
function CellEditor({ row, onClose, getSession, dataColumn }: EditCellProps) {
  const initial = getSession().document?.rows[row.documentIndex]?.cells[dataColumn] ?? "";
  const [value, setValue] = useState(initial);
  const composing = useRef(false);
  const cancelled = useRef(false);

  const commit = useCallback(() => {
    if (cancelled.current) return;
    getSession().dispatch({ type: "set-cell", position: { rowIdx: row.documentIndex, colIdx: dataColumn }, value }, "Edit cell");
    onClose(true);
  }, [getSession, row.documentIndex, dataColumn, value, onClose]);

  return (
    <input
      className="csv-cell-editor"
      autoFocus
      value={value}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={(event) => {
        composing.current = false;
        setValue(event.currentTarget.value);
      }}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (composing.current) return; // IME composition: never confirm/move
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          cancelled.current = true;
          onClose(false);
        }
      }}
    />
  );
}

export function SpreadsheetGrid({ session, ariaLabel }: { session: SheetSession; ariaLabel?: string }) {
  const gridRef = useRef<DataGridHandle>(null);
  const dragging = useRef(false);
  const { document, headerMode, selection, setSelection, filtered, visibleRows, display } = session;

  // Refs holding the latest dynamic data so column renderers can read fresh
  // values without being part of the `columns` memo deps. Rebuilding the column
  // array on every keystroke would remount the open cell editor (detaching it
  // mid-edit), so draft changes do not invalidate columns.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const displayRef = useRef(display);
  displayRef.current = display;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  useEffect(() => {
    const stop = () => { dragging.current = false; };
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
    };
  }, []);

  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(() => {
    const map = new Map<string, { type: "resized" | "measured"; width: number }>();
    for (const [key, width] of Object.entries(session.view.columnWidths ?? {}))
      map.set(key, { type: "resized", width });
    return map;
  });
  const [filterColumn, setFilterColumn] = useState<{ column: number; anchor: { x: number; y: number } } | null>(null);

  const gridShape = useMemo(() => {
    if (!document) return { rowCount: 0, columnCount: 0 };
    return computeGridShape(document, { maxRows: CSV_LIMITS.rows, maxColumns: CSV_LIMITS.columns });
  }, [document]);

  // Frozen top rows: the first N document rows (in visible order), excluded from
  // the scrolling body. Clamped so at least 3 normal rows stay visible isn't
  // enforced here (RDG handles overflow); requested count is preserved in view.
  const frozenRowCount = Math.min(session.view.frozenRows ?? 0, Math.max(0, visibleRows.length - 1));

  const displayRows = useMemo<DisplayRow[]>(() => {
    if (!document) return [];
    return buildDisplayRows({
      document,
      visibleDocumentIndexes: visibleRows,
      gridRowCount: gridShape.rowCount,
      headerMode,
      filtered,
    });
  }, [document, visibleRows, gridShape.rowCount, headerMode, filtered]);

  // Split off the frozen rows into topSummaryRows; the rest scroll normally.
  const topSummaryRows = useMemo(() => displayRows.slice(0, frozenRowCount), [displayRows, frozenRowCount]);
  const rows = useMemo(() => displayRows.slice(frozenRowCount) as unknown as GridRow[], [displayRows, frozenRowCount]);

  const applySelectionAt = useCallback(
    (documentIndex: number, dataColumn: number, mods: { shift: boolean; meta: boolean }) => {
      const position = { rowIdx: documentIndex, colIdx: dataColumn };
      const current = session.selection;
      if (mods.shift) {
        const ranges: SelectionRange[] = [
          ...current.ranges.slice(0, -1),
          { anchor: current.anchor, focus: position, kind: "cell" },
        ];
        setSelection({ activeCell: position, anchor: current.anchor, ranges });
        return;
      }
      if (mods.meta) {
        if (selectionContains(current, documentIndex, dataColumn)) {
          setSelection({ activeCell: position, anchor: position, ranges: removeCellFromRanges(current.ranges, position) });
          return;
        }
        setSelection({
          activeCell: position,
          anchor: position,
          ranges: [...current.ranges, { anchor: position, focus: position, kind: "cell" }],
        });
        return;
      }
      const range = current.ranges[0];
      if (current.ranges.length === 1 && range?.kind === "cell" &&
          range.anchor.rowIdx === documentIndex && range.anchor.colIdx === dataColumn &&
          range.focus.rowIdx === documentIndex && range.focus.colIdx === dataColumn) return;
      setSelection(singleSelection(position));
    },
    [session, setSelection],
  );

  const frozenColumns = session.view.frozenColumns ?? 0;
  const readonlyReasonKey = session.readonlyReason ?? "";
  const columns = useMemo<Column<GridRow>[]>(() => {
    if (!document) return [];
    const rowNumber: Column<GridRow> = {
      key: "__row_number__",
      name: "#",
      width: 54,
      minWidth: 42,
      frozen: true,
      cellClass: "csv-row-number",
      renderCell: ({ row }) => row.rowNumber,
      renderSummaryCell: ({ row }) => (row as unknown as GridRow).rowNumber,
    };
    const renderSheetCell = (row: GridRow, dataColumn: number) => {
      const cell = displayRef.current[row.documentIndex]?.[dataColumn];
      const text = cell?.text ?? "";
      return (
        <div
          className={`csv-cell-value${cell?.numeric ? " csv-numeric" : ""}${cell?.isError ? " csv-error" : ""}`}
          data-sheet-cell={`${row.documentIndex}:${dataColumn}`}
          title={cell?.isError ? "Formula error" : text}
          onMouseDown={(event) => {
            // Summary rows do not receive RDG's onCellMouseDown callback.
            if (event.button !== 0 || !topSummaryRows.some((item) => item.documentIndex === row.documentIndex)) return;
            applySelectionAt(row.documentIndex, dataColumn, { shift: event.shiftKey, meta: event.metaKey || event.ctrlKey });
            dragging.current = true;
          }}
          onPointerEnter={(event) => {
            if (!(event.buttons & 1)) dragging.current = false;
            if (dragging.current) {
              const current = sessionRef.current.selection;
              sessionRef.current.setSelection({
                ...current,
                ranges: [
                  ...current.ranges.slice(0, -1),
                  { anchor: current.anchor, focus: { rowIdx: row.documentIndex, colIdx: dataColumn }, kind: "cell" },
                ],
              });
            }
          }}
        >
          {text}
        </div>
      );
    };
    const dataColumns = Array.from({ length: gridShape.columnCount }, (_, dataColumn): Column<GridRow> => ({
      key: `c${dataColumn}`,
      name: headerMode ? (document.rows[0]?.cells[dataColumn] || columnLabel(dataColumn)) : columnLabel(dataColumn),
      width: 140,
      minWidth: 60,
      resizable: true,
      frozen: dataColumn < frozenColumns,
      cellClass: (row) => {
        const classes: string[] = [];
        if (row.isHeader) classes.push("csv-header-cell");
        const sel = selectionRef.current;
        if (selectionContains(sel, row.documentIndex, dataColumn)) classes.push("csv-range-selected");
        if (sel.activeCell.rowIdx === row.documentIndex && sel.activeCell.colIdx === dataColumn)
          classes.push("csv-active-cell");
        return classes.join(" ") || undefined;
      },
      summaryCellClass: (row) => {
        const index = (row as unknown as GridRow).documentIndex;
        return selectionContains(selectionRef.current, index, dataColumn) ? "csv-range-selected" : undefined;
      },
      renderCell: ({ row }) => renderSheetCell(row, dataColumn),
      renderHeaderCell: ({ column }) => {
        const active = hasActiveClause(sessionRef.current.filters[dataColumn] ?? {});
        return (
          <div className="csv-header-label">
            <span className="csv-header-text">{column.name}</span>
            <button
              type="button"
              className={`csv-header-filter${active ? " csv-header-filter-active" : ""}`}
              aria-label={`Filter ${column.name}`}
              onClick={(e) => {
                e.stopPropagation();
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setFilterColumn({ column: dataColumn, anchor: { x: rect.left, y: rect.bottom } });
              }}
            >
              <Filter size={11} />
            </button>
          </div>
        );
      },
      // Frozen rows render via summary cells; they share the same cell UI and
      // selection wiring. Editing frozen cells is done through the formula bar
      // (the shared edit path) since RDG summary rows have no inline editor.
      renderSummaryCell: ({ row }) => renderSheetCell(row as unknown as GridRow, dataColumn),
      renderEditCell: (props) => <CellEditor {...props} getSession={() => sessionRef.current} dataColumn={dataColumn} />,
      editable: !session.readonlyReason,
    }));
    return [rowNumber, ...dataColumns];
    // RDG memoizes cells: selection must invalidate columns to repaint ranges.
    // Draft keystrokes do not change selection, keeping the cell editor stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document, gridShape.columnCount, headerMode, frozenColumns, readonlyReasonKey, selection, topSummaryRows]);

  const stopDragging = useCallback(() => {
    dragging.current = false;
  }, []);

  if (!document) return <div className="csv-loading">Loading CSV…</div>;

  return (
    <div className="csv-grid-wrap" onPointerUp={stopDragging}>
      <DataGrid<GridRow>
        ref={gridRef}
        aria-label={ariaLabel ?? "Spreadsheet"}
        columns={columns}
        rows={rows}
        topSummaryRows={frozenRowCount > 0 ? topSummaryRows : undefined}
        rowKeyGetter={(row) => row.key}
        columnWidths={columnWidths}
        onColumnWidthsChange={(widths) => {
          setColumnWidths(widths);
          // Persist data-column widths only (exclude the row-number gutter).
          const persisted: Record<string, number> = {};
          for (const [key, value] of widths) {
            if (key === "__row_number__") continue;
            persisted[key] = value.width;
          }
          session.updateView({ columnWidths: persisted });
        }}
        onCellMouseDown={({ column, row }, event) => {
          if (event.button !== 0) return;
          if (!column.key.startsWith("c")) return;
          const dataColumn = Number(column.key.slice(1));
          if (!Number.isInteger(dataColumn)) return;
          const shift = event.shiftKey;
          const meta = event.metaKey || event.ctrlKey;
          if (shift || meta) {
            // Custom multi-select: preventGridDefault so RDG doesn't reset it.
            event.preventGridDefault();
            applySelectionAt(row.documentIndex, dataColumn, { shift, meta });
          } else {
            // Plain click: RDG sets the active cell; onActivePositionChange
            // syncs it. Begin a drag-select from here.
            applySelectionAt(row.documentIndex, dataColumn, { shift: false, meta: false });
          }
          dragging.current = true;
        }}
        onActivePositionChange={({ row, column }) => {
          // Sync single-cell navigation (arrow keys, clicks) into the model so
          // the formula bar and active-cell outline follow RDG's own cursor.
          if (dragging.current || !row || !column || !column.key.startsWith("c")) return;
          const dataColumn = Number(column.key.slice(1));
          if (!Number.isInteger(dataColumn)) return;
          const position = { rowIdx: row.documentIndex, colIdx: dataColumn };
          const current = session.selection;
          if (current.activeCell.rowIdx === position.rowIdx && current.activeCell.colIdx === position.colIdx) return;
          // Only replace the whole selection on a plain move (single range).
          if (current.ranges.length <= 1) setSelection(singleSelection(position));
          else setSelection({ ...current, activeCell: position });
        }}
        onCellKeyDown={(args, event) => {
          if (args.mode !== "ACTIVE") return;
          const command = event.metaKey || event.ctrlKey;
          if ((event.key === "Delete" || event.key === "Backspace") && !session.readonlyReason) {
            event.preventGridDefault();
            for (const range of selection.ranges) session.dispatch({ type: "clear-range", range }, "Clear");
            return;
          }
          if (event.shiftKey && !filtered) {
            const delta =
              event.key === "ArrowUp" ? [-1, 0] :
              event.key === "ArrowDown" ? [1, 0] :
              event.key === "ArrowLeft" ? [0, -1] :
              event.key === "ArrowRight" ? [0, 1] : null;
            if (delta) {
              event.preventGridDefault();
              const focus = {
                rowIdx: Math.max(headerMode ? 0 : 0, Math.min(gridShape.rowCount - 1, selection.activeCell.rowIdx + delta[0]!)),
                colIdx: Math.max(0, Math.min(gridShape.columnCount - 1, selection.activeCell.colIdx + delta[1]!)),
              };
              const current = session.selection;
              setSelection({
                ...current,
                activeCell: focus,
                ranges: [
                  ...current.ranges.slice(0, -1),
                  { anchor: current.anchor, focus, kind: "cell" },
                ],
              });
            }
          }
          void command;
        }}
        className="csv-grid"
        rowHeight={28}
        headerRowHeight={30}
      />
      {filterColumn && (
        <ColumnFilterMenu
          session={session}
          column={filterColumn.column}
          anchor={filterColumn.anchor}
          onClose={() => setFilterColumn(null)}
        />
      )}
    </div>
  );
}
