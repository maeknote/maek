import { useEffect, useRef, useState } from "react";
import { columnLabel } from "../model";
import type { SheetSession } from "../sheet-session";

/**
 * Formula bar: shows the active cell's A1 name box and edits its raw
 * cell/formula string. Enter/Tab confirm into the document; Escape reverts.
 * IME composition never triggers confirm/move.
 */
export function FormulaBar({ session }: { session: SheetSession }) {
  const { selection, document } = session;
  const active = selection.activeCell;
  const rawValue = document?.rows[active.rowIdx]?.cells[active.colIdx] ?? "";
  const [draft, setDraft] = useState(rawValue);
  const composing = useRef(false);

  // Sync the draft when the active cell or its underlying value changes.
  useEffect(() => {
    setDraft(rawValue);
  }, [active.rowIdx, active.colIdx, rawValue]);

  const commit = () => {
    if (draft === rawValue) return;
    session.dispatch({ type: "set-cell", position: { rowIdx: active.rowIdx, colIdx: active.colIdx }, value: draft }, "Edit formula");
  };

  const nameBox = `${columnLabel(active.colIdx)}${active.rowIdx + 1}`;

  return (
    <div className="csv-formula-bar" style={{ height: session.view.formulaBarHeight ?? 36 }}>
      <span className="csv-name-box" aria-label="Active cell">{nameBox}</span>
      <input
        className="csv-formula-input"
        aria-label="Cell value or formula"
        value={draft}
        disabled={!!session.readonlyReason}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          setDraft(event.currentTarget.value);
        }}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (composing.current) return;
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            setDraft(rawValue);
          }
        }}
        onBlur={commit}
      />
    </div>
  );
}
