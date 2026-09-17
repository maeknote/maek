import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DataGrid,
  type Column,
  type ColumnWidths,
  type DataGridHandle,
  type RenderEditCellProps,
  type SortColumn,
} from "react-data-grid";
import {
  Columns3,
  Filter,
  Plus,
  Redo2,
  Rows3,
  Search,
  Trash2,
  Undo2,
} from "lucide-react";
import "react-data-grid/lib/styles.css";
import "./spreadsheet.css";
import type { Tab } from "../../store";
import { useStore } from "../../store";
import { parseTsv, rangeToTsv } from "./clipboard";
import {
  clearRange,
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  pasteMatrix,
  sortRows,
} from "./commands";
import { serializeCsv } from "./csv-codec";
import { cloneDocument, columnLabel, type SpreadsheetDocument } from "./model";
import { containsCell, normalizeRange, type CellRange } from "./selection";
import { parseCsvAsync } from "./worker-client";

interface GridRow {
  id: string;
  cells: string[];
  sourceIndex: number;
}

interface CellEditorProps extends RenderEditCellProps<GridRow> {
  columnIndex: number;
}

function CellEditor({ row, onRowChange, onClose, columnIndex }: CellEditorProps) {
  const [value, setValue] = useState(row.cells[columnIndex] ?? "");
  const composing = useRef(false);
  return (
    <input
      className="csv-cell-editor"
      autoFocus
      value={value}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={(event) => { composing.current = false; setValue(event.currentTarget.value); }}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => { const cells = [...row.cells]; cells[columnIndex] = value; onRowChange({ ...row, cells }, true); }}
      onKeyDown={(event) => {
        if (composing.current) return;
        if (event.key === "Enter" || event.key === "Tab") {
          const cells = [...row.cells]; cells[columnIndex] = value; onRowChange({ ...row, cells }, true);
        } else if (event.key === "Escape") onClose(false);
      }}
    />
  );
}

function cloneHistoryEntry(document: SpreadsheetDocument) {
  return cloneDocument(document);
}

function estimatedDocumentBytes(document: SpreadsheetDocument): number {
  return document.rows.reduce((sum, row) => sum + 48 + row.cells.reduce((cells, value) => cells + value.length * 2 + 8, 0), 0);
}

export default function SpreadsheetEditor({ tab }: { tab: Tab }) {
  const updateBody = useStore((state) => state.updateBody);
  const save = useStore((state) => state.save);
  const setError = useStore((state) => state.setError);
  const [document, setDocument] = useState<SpreadsheetDocument | null>(null);
  const [readonlyReason, setReadonlyReason] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [selection, setSelection] = useState<CellRange | null>(null);
  const [headerMode, setHeaderMode] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [findText, setFindText] = useState("");
  const [sortColumns, setSortColumns] = useState<readonly SortColumn[]>([]);
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(() => new Map());
  const [historyRevision, setHistoryRevision] = useState(0);
  const past = useRef<SpreadsheetDocument[]>([]);
  const future = useRef<SpreadsheetDocument[]>([]);
  const pastBytes = useRef(0);
  const dragging = useRef(false);
  const gridRef = useRef<DataGridHandle>(null);

  useEffect(() => {
    let active = true;
    setDocument(null);
    void parseCsvAsync(tab.bodyContent).then((result) => {
      if (!active) return;
      setDocument(result.document);
      setReadonlyReason(result.readonlyReason);
      setWarnings(result.warnings);
    }).catch((error) => { if (active) setReadonlyReason(String(error)); });
    return () => { active = false; };
  }, [tab.id, tab.generation]);

  useEffect(() => {
    const stopDragging = () => { dragging.current = false; };
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => { window.removeEventListener("pointerup", stopDragging); window.removeEventListener("pointercancel", stopDragging); };
  }, []);

  const commit = useCallback((next: SpreadsheetDocument) => {
    if (!document || readonlyReason) return;
    past.current.push(cloneHistoryEntry(document));
    pastBytes.current += estimatedDocumentBytes(document);
    while (past.current.length > 100 || pastBytes.current > 20 * 1024 * 1024) {
      const removed = past.current.shift();
      if (removed) pastBytes.current -= estimatedDocumentBytes(removed);
    }
    future.current = [];
    setDocument(next);
    updateBody(tab.id, serializeCsv(next));
    setHistoryRevision((value) => value + 1);
  }, [document, readonlyReason, tab.id, updateBody]);

  const undo = useCallback(() => {
    if (!document || !past.current.length || readonlyReason) return;
    const previous = past.current.pop()!;
    pastBytes.current -= estimatedDocumentBytes(previous);
    future.current.push(cloneHistoryEntry(document));
    setDocument(previous);
    updateBody(tab.id, serializeCsv(previous));
    setHistoryRevision((value) => value + 1);
  }, [document, readonlyReason, tab.id, updateBody]);

  const redo = useCallback(() => {
    if (!document || !future.current.length || readonlyReason) return;
    const next = future.current.pop()!;
    past.current.push(cloneHistoryEntry(document));
    pastBytes.current += estimatedDocumentBytes(document);
    setDocument(next);
    updateBody(tab.id, serializeCsv(next));
    setHistoryRevision((value) => value + 1);
  }, [document, readonlyReason, tab.id, updateBody]);

  const sourceRows = useMemo(() => {
    if (!document) return [];
    return document.rows.map((row, sourceIndex) => ({ id: row.id, cells: row.cells, sourceIndex }))
      .filter((_, index) => !headerMode || index > 0)
      .filter((row) => !filterText || row.cells.some((cell) => cell.toLocaleLowerCase().includes(filterText.toLocaleLowerCase())));
  }, [document, headerMode, filterText]);

  const columns = useMemo<Column<GridRow>[]>(() => {
    if (!document) return [];
    const rowNumber: Column<GridRow> = {
      key: "__row_number__",
      name: "#",
      width: 54,
      minWidth: 42,
      frozen: true,
      cellClass: "csv-row-number",
      renderCell: ({ row }) => row.sourceIndex + 1,
    };
    return [rowNumber, ...Array.from({ length: document.columnCount }, (_, columnIndex): Column<GridRow> => ({
      key: `c${columnIndex}`,
      name: headerMode ? (document.rows[0]?.cells[columnIndex] || columnLabel(columnIndex)) : columnLabel(columnIndex),
      width: 140,
      minWidth: 70,
      resizable: true,
      sortable: true,
      editable: !readonlyReason,
      cellClass: (row) => selection && containsCell(selection, row.sourceIndex, columnIndex) ? "csv-range-selected" : undefined,
      renderCell: ({ row }) => (
        <div
          className="csv-cell-value"
          onPointerEnter={() => {
            if (dragging.current && selection && !filterText)
              setSelection({ ...selection, focus: { rowIdx: row.sourceIndex, colIdx: columnIndex } });
          }}
          title={row.cells[columnIndex] ?? ""}
        >
          {row.cells[columnIndex] ?? ""}
        </div>
      ),
      renderEditCell: (props) => <CellEditor {...props} columnIndex={columnIndex} />,
    }))];
  }, [document, headerMode, readonlyReason, selection, filterText]);

  const run = (operation: () => SpreadsheetDocument) => {
    try { commit(operation()); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  };

  const copySelection = (event: React.ClipboardEvent, cut = false) => {
    if (!document || !selection) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", rangeToTsv(document, selection));
    if (cut && !readonlyReason) commit(clearRange(document, selection));
  };

  const paste = (event: React.ClipboardEvent) => {
    if (!document || !selection || readonlyReason || filterText) return;
    event.preventDefault();
    const matrix = parseTsv(event.clipboardData.getData("text/plain"));
    const start = normalizeRange(selection);
    run(() => pasteMatrix(document, { rowIdx: start.top, colIdx: start.left }, matrix));
    setSelection({ anchor: { rowIdx: start.top, colIdx: start.left }, focus: { rowIdx: start.top + matrix.length - 1, colIdx: start.left + Math.max(...matrix.map((row) => row.length)) - 1 } });
  };

  const stats = useMemo(() => {
    if (!document || !selection) return null;
    const range = normalizeRange(selection);
    const values: string[] = [];
    for (let row = range.top; row <= range.bottom; row++) for (let column = range.left; column <= range.right; column++) {
      const value = document.rows[row]?.cells[column] ?? "";
      if (value !== "") values.push(value);
    }
    const numbers = values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
    const sum = numbers.reduce((total, value) => total + value, 0);
    return { count: values.length, numericCount: numbers.length, sum, average: numbers.length ? sum / numbers.length : null };
  }, [document, selection]);

  if (!document) return <div className="csv-loading">Loading CSV…</div>;
  const selected = selection ? normalizeRange(selection) : { top: headerMode ? 1 : 0, bottom: headerMode ? 1 : 0, left: 0, right: 0 };
  const structuralDisabled = !!readonlyReason || !!filterText;
  const findCount = findText ? document.rows.reduce((count, row) => count + row.cells.filter((cell) => cell.toLocaleLowerCase().includes(findText.toLocaleLowerCase())).length, 0) : 0;
  const findNext = () => {
    if (!findText) return;
    const needle = findText.toLocaleLowerCase();
    const startRow = selection?.focus.rowIdx ?? (headerMode ? 1 : 0);
    const startColumn = selection?.focus.colIdx ?? -1;
    const rowCount = document.rows.length;
    for (let offset = 0; offset < rowCount; offset++) {
      const rowIdx = (startRow + offset) % rowCount;
      if (headerMode && rowIdx === 0) continue;
      const row = document.rows[rowIdx]!;
      const firstColumn = offset === 0 ? startColumn + 1 : 0;
      for (let colIdx = firstColumn; colIdx < document.columnCount; colIdx++) {
        if ((row.cells[colIdx] ?? "").toLocaleLowerCase().includes(needle)) {
          setSelection({ anchor: { rowIdx, colIdx }, focus: { rowIdx, colIdx } });
          const visibleRow = sourceRows.findIndex((item) => item.sourceIndex === rowIdx);
          if (visibleRow >= 0) gridRef.current?.scrollToCell({ rowIdx: visibleRow, idx: colIdx + 1 });
          return;
        }
      }
    }
    // Wrap within the starting row when the current match is not its last cell.
    const row = document.rows[startRow];
    for (let colIdx = 0; row && colIdx <= startColumn; colIdx++) {
      if ((row.cells[colIdx] ?? "").toLocaleLowerCase().includes(needle)) {
        setSelection({ anchor: { rowIdx: startRow, colIdx }, focus: { rowIdx: startRow, colIdx } });
        gridRef.current?.scrollToCell({ rowIdx: sourceRows.findIndex((item) => item.sourceIndex === startRow), idx: colIdx + 1 });
        return;
      }
    }
  };

  return (
    <section
      className="csv-editor"
      aria-label={`Spreadsheet editor for ${tab.name}`}
      onCopy={(event) => copySelection(event)}
      onCut={(event) => copySelection(event, true)}
      onPaste={paste}
      onKeyDownCapture={(event) => {
        const command = event.metaKey || event.ctrlKey;
        if (command && event.key.toLocaleLowerCase() === "s") { event.preventDefault(); void save(tab.id); return; }
        if ((event.target as HTMLElement).matches("input,textarea")) return;
        if (command && event.key.toLocaleLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
        if (command && event.key.toLocaleLowerCase() === "y") { event.preventDefault(); redo(); }
        if ((event.key === "Delete" || event.key === "Backspace") && selection && !readonlyReason) { event.preventDefault(); commit(clearRange(document, selection)); }
      }}
    >
      <div className="csv-toolbar" role="toolbar" aria-label="Spreadsheet tools">
        <button onClick={undo} disabled={!past.current.length || !!readonlyReason} aria-label="Undo"><Undo2 size={15} /></button>
        <button onClick={redo} disabled={!future.current.length || !!readonlyReason} aria-label="Redo"><Redo2 size={15} /></button>
        <span className="csv-toolbar-separator" />
        <button onClick={() => run(() => insertRow(document, selected.top))} disabled={structuralDisabled} aria-label="Insert row above"><Plus size={14} /><Rows3 size={15} /></button>
        <button onClick={() => run(() => deleteRow(document, selected.top))} disabled={structuralDisabled} aria-label="Delete row"><Trash2 size={14} /><Rows3 size={15} /></button>
        <button onClick={() => run(() => insertColumn(document, selected.left))} disabled={structuralDisabled} aria-label="Insert column left"><Plus size={14} /><Columns3 size={15} /></button>
        <button onClick={() => run(() => deleteColumn(document, selected.left))} disabled={structuralDisabled} aria-label="Delete column"><Trash2 size={14} /><Columns3 size={15} /></button>
        <span className="csv-toolbar-separator" />
        <label className="csv-toggle"><input type="checkbox" checked={headerMode} onChange={(event) => { setHeaderMode(event.target.checked); setSelection(null); }} /> First row is header</label>
        <label className="csv-search"><Filter size={14} /><input aria-label="Filter rows" placeholder="Filter rows" value={filterText} onChange={(event) => { setFilterText(event.target.value); setSelection(null); }} /></label>
        <label className="csv-search"><Search size={14} /><input aria-label="Find in sheet" placeholder="Find" value={findText} onChange={(event) => setFindText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); findNext(); } }} />{findText && <button type="button" onClick={findNext} title="Find next">{findCount}</button>}</label>
      </div>
      {(readonlyReason || warnings.length > 0) && <div className={readonlyReason ? "csv-banner csv-banner-error" : "csv-banner"} role="status">{readonlyReason ?? warnings[0]}</div>}
      <div className="csv-grid-wrap">
        <DataGrid<GridRow>
          ref={gridRef}
          aria-label={tab.name}
          columns={columns}
          rows={sourceRows}
          rowKeyGetter={(row) => row.id}
          columnWidths={columnWidths}
          onColumnWidthsChange={setColumnWidths}
          sortColumns={sortColumns}
          onSortColumnsChange={(next) => {
            const sort = next.at(-1);
            if (!sort || readonlyReason) { setSortColumns([]); return; }
            const columnIndex = Number(sort.columnKey.slice(1));
            if (!Number.isInteger(columnIndex)) return;
            commit(sortRows(document, columnIndex, sort.direction, headerMode));
            setSortColumns([sort]);
            setSelection(null);
          }}
          onRowsChange={(rows, data) => {
            if (readonlyReason) return;
            const columnIndex = Number(data.column.key.slice(1));
            if (!Number.isInteger(columnIndex)) return;
            const next = cloneDocument(document);
            for (const visibleIndex of data.indexes) {
              const changed = rows[visibleIndex];
              if (!changed) continue;
              const row = next.rows[changed.sourceIndex]!;
              row.cells[columnIndex] = changed.cells[columnIndex] ?? "";
              row.fieldCount = Math.max(row.fieldCount, columnIndex + 1);
            }
            commit(next);
          }}
          onCellMouseDown={({ column, row }, event) => {
            if (!column.key.startsWith("c")) return;
            const colIdx = Number(column.key.slice(1));
            if (filterText) {
              setSelection({ anchor: { rowIdx: row.sourceIndex, colIdx }, focus: { rowIdx: row.sourceIndex, colIdx } });
              return;
            }
            if (event.shiftKey && selection) setSelection({ ...selection, focus: { rowIdx: row.sourceIndex, colIdx } });
            else setSelection({ anchor: { rowIdx: row.sourceIndex, colIdx }, focus: { rowIdx: row.sourceIndex, colIdx } });
            dragging.current = true;
          }}
          onCellKeyDown={(args, event) => {
            if (args.mode !== "ACTIVE" || !event.shiftKey || !selection || filterText) return;
            const delta = event.key === "ArrowUp" ? [-1, 0] : event.key === "ArrowDown" ? [1, 0] : event.key === "ArrowLeft" ? [0, -1] : event.key === "ArrowRight" ? [0, 1] : null;
            if (!delta) return;
            event.preventGridDefault();
            const minRow = headerMode ? 1 : 0;
            const focus = {
              rowIdx: Math.max(minRow, Math.min(document.rows.length - 1, selection.focus.rowIdx + delta[0]!)),
              colIdx: Math.max(0, Math.min(document.columnCount - 1, selection.focus.colIdx + delta[1]!)),
            };
            setSelection({ ...selection, focus });
          }}
          className="rdg-light csv-grid"
          rowHeight={32}
          headerRowHeight={34}
        />
      </div>
      <footer className="csv-statusbar">
        <span>{document.rows.length.toLocaleString()} rows × {document.columnCount.toLocaleString()} columns</span>
        {stats && <span>Count {stats.count}{stats.numericCount ? ` · Sum ${stats.sum.toLocaleString()} · Average ${stats.average!.toLocaleString()}` : ""}</span>}
        <span className="sr-only">History revision {historyRevision}</span>
      </footer>
    </section>
  );
}
