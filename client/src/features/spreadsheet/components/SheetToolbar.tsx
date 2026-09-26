import { useRef, useState } from "react";
import { Redo2, Undo2, ChevronDown, Search } from "lucide-react";
import { FloatingMenu, MenuItem, MenuSeparator } from "@renderer/shared/components";
import { normalizeRange } from "../selection";
import { resolveSelectionRows } from "../selection";
import { buildRowPermutation, sortTargetRows, applyRowPermutation } from "../sorting";
import { mergeFormulaReferences } from "../formula-engine";
import { trimCellsIn, removeBlankRowsIn, removeDuplicateRowsIn } from "../cleanup";
import type { SheetSession } from "../sheet-session";

type MenuName = "edit" | "data" | "view" | null;

/**
 * Command bar: undo/redo plus Edit, Data, and View menus. Kept to a single
 * non-wrapping row; overflow-prone actions live inside the menus.
 */
export function SheetToolbar({ session, onToggleFind }: { session: SheetSession; onToggleFind?: () => void }) {
  const [open, setOpen] = useState<MenuName>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const dataRef = useRef<HTMLButtonElement>(null);
  const viewRef = useRef<HTMLButtonElement>(null);

  const { selection, document, readonlyReason, headerMode, filtered } = session;
  const disabled = !!readonlyReason;
  const structuralDisabled = disabled || filtered;

  const activeRange = normalizeRange(selection.ranges[selection.ranges.length - 1] ?? { anchor: selection.activeCell, focus: selection.activeCell });

  const openMenu = (name: MenuName, ref: React.RefObject<HTMLButtonElement | null>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setAnchor({ x: rect.left, y: rect.bottom });
    setOpen(name);
  };
  const close = () => setOpen(null);

  const targetDataRows = () => {
    if (!document) return [];
    const selectedRows = resolveSelectionRows(selection, session.visibleRows);
    // Single-cell selection → all visible data rows; else the selected rows.
    const rows = selectedRows.length > 1 ? selectedRows : session.visibleRows;
    return rows.filter((rowIdx) => !(headerMode && rowIdx === 0));
  };

  const runSort = (direction: "ASC" | "DESC") => {
    if (!document) return;
    const targetRows = targetDataRows();
    const column = activeRange.left;
    const sorted = sortTargetRows({
      targetRows,
      conditions: [{ column, direction }],
      getSortValue: (r, c) => session.displayValue(r, c),
    });
    const permutation = buildRowPermutation({ document, targetRows, sortedTargetRows: sorted });
    const reordered = applyRowPermutation(document, permutation);
    let merged = reordered;
    try {
      merged = mergeFormulaReferences(reordered, document, { type: "set-row-order", permutation });
    } catch {
      // If the engine rejects, fall back to the plain reorder.
      merged = reordered;
    }
    session.dispatchDocument?.(merged, "Sort");
    close();
  };

  return (
    <div className="csv-toolbar" role="toolbar" aria-label="Spreadsheet tools">
      <button onClick={session.undo} disabled={!session.canUndo || disabled} aria-label="Undo" title="Undo (⌘Z)">
        <Undo2 size={15} />
      </button>
      <button onClick={session.redo} disabled={!session.canRedo || disabled} aria-label="Redo" title="Redo (⇧⌘Z)">
        <Redo2 size={15} />
      </button>
      <span className="csv-toolbar-separator" />

      <button ref={editRef} className="csv-menu-button" onClick={() => openMenu("edit", editRef)} aria-haspopup="menu">
        Edit <ChevronDown size={13} />
      </button>
      <button ref={dataRef} className="csv-menu-button" onClick={() => openMenu("data", dataRef)} aria-haspopup="menu">
        Data <ChevronDown size={13} />
      </button>
      <button ref={viewRef} className="csv-menu-button" onClick={() => openMenu("view", viewRef)} aria-haspopup="menu">
        View <ChevronDown size={13} />
      </button>
      <span className="csv-toolbar-separator" />
      <button className="csv-menu-button" onClick={() => onToggleFind?.()} aria-label="Find and replace" title="Find (⌘F)">
        <Search size={14} /> Find
      </button>

      <FloatingMenu isOpen={open === "edit"} position={anchor} onClose={close} anchorRef={editRef}>
        <MenuItem label="Insert row above" disabled={structuralDisabled} onClick={() => { session.dispatch({ type: "insert-row", index: activeRange.top }, "Insert row"); close(); }} />
        <MenuItem label="Delete row" disabled={structuralDisabled} onClick={() => { session.dispatch({ type: "delete-row", index: activeRange.top }, "Delete row"); close(); }} />
        <MenuItem label="Insert column left" disabled={structuralDisabled} onClick={() => { session.dispatch({ type: "insert-column", index: activeRange.left }, "Insert column"); close(); }} />
        <MenuItem label="Delete column" disabled={structuralDisabled} onClick={() => { session.dispatch({ type: "delete-column", index: activeRange.left }, "Delete column"); close(); }} />
        <MenuSeparator />
        <MenuItem label="Fill down" disabled={disabled} onClick={() => { session.fill("down"); close(); }} />
        <MenuItem label="Fill right" disabled={disabled} onClick={() => { session.fill("right"); close(); }} />
        <MenuSeparator />
        <MenuItem label="Paste values" disabled={disabled} onClick={() => { session.pasteValues(); close(); }} />
        <MenuItem label="Clear values" disabled={disabled} onClick={() => { for (const range of selection.ranges) session.dispatch({ type: "clear-range", range }, "Clear"); close(); }} />
      </FloatingMenu>

      <FloatingMenu isOpen={open === "data"} position={anchor} onClose={close} anchorRef={dataRef}>
        <MenuItem label="Sort ascending" disabled={disabled} onClick={() => runSort("ASC")} />
        <MenuItem label="Sort descending" disabled={disabled} onClick={() => runSort("DESC")} />
        <MenuSeparator />
        <MenuItem label="Reset filters" disabled={!filtered} onClick={() => { session.updateView({ filters: {} }); close(); }} />
        <MenuSeparator />
        <MenuItem label="Trim spaces" disabled={structuralDisabled} onClick={() => { if (document) { const { next } = trimCellsIn(document, targetDataRows()); session.dispatchDocument?.(next, "Trim spaces"); } close(); }} />
        <MenuItem label="Remove blank rows" disabled={structuralDisabled} onClick={() => { if (document) { const { next } = removeBlankRowsIn(document, targetDataRows(), headerMode); session.dispatchDocument?.(next, "Remove blank rows"); } close(); }} />
        <MenuItem label="Remove duplicate rows" disabled={structuralDisabled} onClick={() => { if (document) { const { next } = removeDuplicateRowsIn({ document, targetRows: targetDataRows(), keyColumns: [], headerMode }); session.dispatchDocument?.(next, "Remove duplicates"); } close(); }} />
      </FloatingMenu>

      <FloatingMenu isOpen={open === "view"} position={anchor} onClose={close} anchorRef={viewRef}>
        <MenuItem label={headerMode ? "✓ First row is header" : "First row is header"} onClick={() => { session.updateView({ headerMode: !headerMode }); close(); }} />
        <MenuSeparator />
        <MenuItem label="Freeze first row" onClick={() => { session.updateView({ frozenRows: 1 }); close(); }} />
        <MenuItem label="Freeze first column" onClick={() => { session.updateView({ frozenColumns: 1 }); close(); }} />
        <MenuItem label="Freeze up to active cell" onClick={() => { session.updateView({ frozenRows: activeRange.top, frozenColumns: activeRange.left }); close(); }} />
        <MenuItem label="Unfreeze" onClick={() => { session.updateView({ frozenRows: 0, frozenColumns: 0 }); close(); }} />
      </FloatingMenu>
    </div>
  );
}
