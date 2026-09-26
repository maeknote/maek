import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { findMatches, replaceLiteral, type SearchOptions } from "../search";
import { replaceText } from "../commands";
import type { SheetSession } from "../sheet-session";
import { singleSelection } from "../selection";

/**
 * Find & replace panel. Defaults to searching visible display values; options
 * enable whole-sheet search and formula-text search. Replacement is literal
 * ($& / $1 are not backreferences).
 */
export function FindReplacePanel({ session, onClose }: { session: SheetSession; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeSheet, setWholeSheet] = useState(false);
  const [formulaText, setFormulaText] = useState(false);
  const [current, setCurrent] = useState(0);

  const search: SearchOptions = { query, caseSensitive, formulaText };

  const matches = useMemo(() => {
    if (!session.document || !query) return [];
    return findMatches({
      document: session.document,
      search,
      visibleRows: wholeSheet ? null : session.visibleRows,
      getDisplayValue: session.displayValue,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.document, query, caseSensitive, formulaText, wholeSheet, session.visibleRows, session.revision]);

  const go = (delta: number) => {
    if (!matches.length) return;
    const next = (current + delta + matches.length) % matches.length;
    setCurrent(next);
    const match = matches[next]!;
    session.setSelection(singleSelection({ rowIdx: match.rowIdx, colIdx: match.colIdx }));
  };

  // Formula cells excluded from display-value replace (their result is derived).
  const excludedFormulaCells = useMemo(() => {
    if (formulaText || !session.document) return 0;
    return matches.filter((m) => (session.document!.rows[m.rowIdx]?.cells[m.colIdx] ?? "").startsWith("=")).length;
  }, [matches, formulaText, session.document]);

  const replaceAll = () => {
    if (!session.document || !query) return;
    if (formulaText) {
      // Replace within raw cell/formula text via a full-document pass.
      session.dispatch({ type: "replace-text", search: query, replacement }, "Replace");
      return;
    }
    // Display-value mode: only replace plain (non-formula) cells' raw text.
    const next = replaceInPlainCells(session, query, replacement, caseSensitive);
    if (next) session.dispatchDocument(next, "Replace");
  };

  return (
    <div className="csv-find-panel" role="search">
      <Search size={13} />
      <input
        className="csv-find-input"
        aria-label="Find"
        placeholder="Find"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setCurrent(0); }}
        onKeyDown={(e) => { if (e.key === "Enter") go(e.shiftKey ? -1 : 1); }}
        autoFocus
      />
      <span className="csv-find-count">{matches.length ? `${current + 1}/${matches.length}` : "0"}</span>
      <button type="button" onClick={() => go(-1)} disabled={!matches.length} aria-label="Previous">‹</button>
      <button type="button" onClick={() => go(1)} disabled={!matches.length} aria-label="Next">›</button>
      <input
        className="csv-find-input"
        aria-label="Replace with"
        placeholder="Replace"
        value={replacement}
        onChange={(e) => setReplacement(e.target.value)}
      />
      <button type="button" onClick={replaceAll} disabled={!query || !!session.readonlyReason}>Replace all</button>
      <label className="csv-find-option"><input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} /> Aa</label>
      <label className="csv-find-option"><input type="checkbox" checked={wholeSheet} onChange={(e) => setWholeSheet(e.target.checked)} /> All</label>
      <label className="csv-find-option"><input type="checkbox" checked={formulaText} onChange={(e) => setFormulaText(e.target.checked)} /> ƒx</label>
      {!formulaText && excludedFormulaCells > 0 && (
        <span className="csv-find-note">{excludedFormulaCells} formula cell(s) excluded</span>
      )}
      <button type="button" onClick={onClose} aria-label="Close find"><X size={13} /></button>
    </div>
  );
}

/** Replace literal text in plain (non-formula) cells only, returning a new document. */
function replaceInPlainCells(session: SheetSession, query: string, replacement: string, caseSensitive: boolean) {
  const document = session.document;
  if (!document) return null;
  let changed = false;
  const rows = document.rows.map((row) => {
    const cells = row.cells.map((cell) => {
      if (cell.startsWith("=")) return cell; // never rewrite formula source here
      const next = replaceLiteral(cell, query, replacement, caseSensitive);
      if (next !== cell) changed = true;
      return next;
    });
    return { ...row, cells };
  });
  // Fall back to the shared command when nothing plain matched but we still want
  // a deterministic no-op path.
  if (!changed) {
    void replaceText; // keep import for potential formula-mode reuse
    return null;
  }
  return { ...document, rows };
}
