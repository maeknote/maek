import "react-data-grid/lib/styles.css";
import "./spreadsheet.css";
import { useRef, useState } from "react";
import type { Tab } from "@renderer/features/workspace";
import { useStore } from "@renderer/features/workspace";
import { useSheetSession } from "./sheet-session";
import { SheetToolbar } from "./components/SheetToolbar";
import { FormulaBar } from "./components/FormulaBar";
import { SpreadsheetGrid } from "./components/SpreadsheetGrid";
import { SheetStatusBar } from "./components/SheetStatusBar";
import { FindReplacePanel } from "./components/FindReplacePanel";
import { rangeToTsv, parseTsv, INTERNAL_CLIPBOARD_TOKEN, type InternalClipboard } from "./clipboard";
import { normalizeRange, isSingleRectangle } from "./selection";
import { adjustFormulaReferences } from "./formula-references";

/**
 * CSV spreadsheet editor. Thin shell that owns the tab wiring and assembles the
 * session-backed sub-views (toolbar, formula bar, grid, status bar).
 */
export default function SpreadsheetEditor({ tab }: { tab: Tab }) {
  const save = useStore((state) => state.save);
  const session = useSheetSession(tab);
  const [showFind, setShowFind] = useState(false);
  // Last internal copy/cut. Internal-ness is verified by this payload + token,
  // never by clipboard-string equality alone (plan F-1).
  const internalClipboard = useRef<InternalClipboard | null>(null);

  const onCopy = (event: React.ClipboardEvent, cut = false) => {
    const { document, selection } = session;
    if (!document || !isSingleRectangle(session.selection)) return;
    // Only intercept when the grid (not an input) has focus.
    if ((event.target as HTMLElement).matches("input,textarea")) return;
    event.preventDefault();
    const range = { anchor: selection.ranges[0]!.anchor, focus: selection.ranges[0]!.focus };
    const norm = normalizeRange(range);
    const text = rangeToTsv(document, range);
    // Record the internal payload: raw strings for reference-adjusting paste,
    // calculated values for value-only paste.
    const raw: string[][] = [];
    const values: string[][] = [];
    for (let r = norm.top; r <= norm.bottom; r++) {
      const rawRow: string[] = [];
      const valRow: string[] = [];
      for (let c = norm.left; c <= norm.right; c++) {
        rawRow.push(document.rows[r]?.cells[c] ?? "");
        valRow.push(session.displayValue(r, c));
      }
      raw.push(rawRow);
      values.push(valRow);
    }
    internalClipboard.current = {
      token: INTERNAL_CLIPBOARD_TOKEN,
      text,
      origin: { row: norm.top, column: norm.left },
      raw,
      values,
      cut,
    };
    session.recordInternalCopy({ origin: { row: norm.top, column: norm.left }, values });
    event.clipboardData.setData("text/plain", text);
    if (cut && !session.readonlyReason) {
      session.dispatch({ type: "clear-range", range }, "Cut");
    }
  };

  const onPaste = (event: React.ClipboardEvent) => {
    const { document, selection, readonlyReason, filtered } = session;
    if (!document || readonlyReason || filtered) return;
    if ((event.target as HTMLElement).matches("input,textarea")) return;
    event.preventDefault();
    const clipboardText = event.clipboardData.getData("text/plain");
    const start = normalizeRange(selection.ranges[selection.ranges.length - 1]!);
    const internal = internalClipboard.current;
    // Verified internal paste into the same document: adjust relative formula
    // references by the destination offset. Otherwise paste the raw text as-is.
    if (internal && internal.token === INTERNAL_CLIPBOARD_TOKEN && internal.text === clipboardText) {
      const rowOffset = start.top - internal.origin.row;
      const columnOffset = start.left - internal.origin.column;
      const matrix = internal.raw.map((row) =>
        row.map((value) => (value.startsWith("=") ? adjustFormulaReferences(value, rowOffset, columnOffset) : value)),
      );
      session.dispatch({ type: "paste", start: { rowIdx: start.top, colIdx: start.left }, matrix }, "Paste");
    } else {
      const matrix = parseTsv(clipboardText);
      session.dispatch({ type: "paste", start: { rowIdx: start.top, colIdx: start.left }, matrix }, "Paste");
    }
  };

  return (
    <section
      className="csv-editor"
      aria-label={`Spreadsheet editor for ${tab.name}`}
      onCopy={(event) => onCopy(event)}
      onCut={(event) => onCopy(event, true)}
      onPaste={onPaste}
      onKeyDownCapture={(event) => {
        const command = event.metaKey || event.ctrlKey;
        if (command && event.key.toLocaleLowerCase() === "s") {
          event.preventDefault();
          (globalThis.document.activeElement as HTMLElement | null)?.blur();
          queueMicrotask(() => {
            void save(tab.id);
          });
          return;
        }
        if (command && event.key.toLocaleLowerCase() === "f") {
          event.preventDefault();
          setShowFind(true);
          return;
        }
        if ((event.target as HTMLElement).matches("input,textarea")) return;
        if (command && event.key.toLocaleLowerCase() === "z") {
          event.preventDefault();
          event.shiftKey ? session.redo() : session.undo();
        }
        if (command && event.key.toLocaleLowerCase() === "y") {
          event.preventDefault();
          session.redo();
        }
      }}
    >
      <SheetToolbar session={session} onToggleFind={() => setShowFind((v) => !v)} />
      <FormulaBar session={session} />
      {showFind && <FindReplacePanel session={session} onClose={() => setShowFind(false)} />}
      {(session.readonlyReason || session.warnings.length > 0) && (
        <div className={session.readonlyReason ? "csv-banner csv-banner-error" : "csv-banner"} role="status">
          {session.readonlyReason ?? session.warnings[0]}
        </div>
      )}
      <SpreadsheetGrid session={session} ariaLabel={tab.name} />
      <SheetStatusBar session={session} />
    </section>
  );
}
