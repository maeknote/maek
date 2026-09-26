import { useMemo } from "react";
import { resolveSelectionCells } from "../selection";
import type { SheetSession } from "../sheet-session";

/** Status bar: selection stats, visible/total rows, and calculation status. */
export function SheetStatusBar({ session }: { session: SheetSession }) {
  const { document, selection, visibleRows, filtered, displayValue, calcError } = session;

  const stats = useMemo(() => {
    if (!document) return null;
    const cells = resolveSelectionCells(selection, visibleRows, document.columnCount);
    const values: string[] = [];
    for (const { rowIdx, colIdx } of cells) {
      const value = displayValue(rowIdx, colIdx);
      if (value !== "") values.push(value);
    }
    const numbers = values
      .map((value) => (/^-?(\d+)(\.\d+)?$/.test(value) && !/^-?0\d/.test(value) ? Number(value) : NaN))
      .filter((value) => Number.isFinite(value));
    const sum = numbers.reduce((total, value) => total + value, 0);
    return {
      count: values.length,
      numericCount: numbers.length,
      sum,
      average: numbers.length ? sum / numbers.length : null,
    };
  }, [document, selection, visibleRows, displayValue]);

  if (!document) return null;
  const totalDataRows = document.rows.length - (session.headerMode ? 1 : 0);
  const visibleDataRows = visibleRows.length - (session.headerMode ? 1 : 0);

  return (
    <footer className="csv-statusbar">
      <span>
        {filtered
          ? `${visibleDataRows.toLocaleString()} / ${totalDataRows.toLocaleString()} rows`
          : `${totalDataRows.toLocaleString()} rows × ${document.columnCount.toLocaleString()} columns`}
      </span>
      {stats && stats.count > 0 && (
        <span>
          Count {stats.count}
          {stats.numericCount ? ` · Sum ${stats.sum.toLocaleString()} · Avg ${stats.average!.toLocaleString()}` : ""}
        </span>
      )}
      <span className={calcError ? "csv-status-error" : "csv-status-ok"}>
        {calcError ? (
          <button type="button" onClick={session.retryCalculation} title={calcError}>
            Calculation failed — retry
          </button>
        ) : (
          "Ready"
        )}
      </span>
    </footer>
  );
}
