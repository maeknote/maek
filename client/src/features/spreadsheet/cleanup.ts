import { cloneDocument, createRow, type SpreadsheetDocument } from "./model";

/**
 * Data-cleanup operations scoped to a target row set, with preview counts.
 * Formula cells (starting with `=`) are excluded from whitespace trimming.
 */

export interface CleanupPreview {
  /** Number of cells/rows that would change. */
  affected: number;
  /** A few example descriptions for the confirm dialog. */
  samples: string[];
}

/** Trim leading/trailing whitespace from plain-string cells in the target rows. */
export function trimCellsIn(document: SpreadsheetDocument, targetRows: number[]): { next: SpreadsheetDocument; preview: CleanupPreview } {
  const next = cloneDocument(document);
  const rowSet = new Set(targetRows);
  let affected = 0;
  const samples: string[] = [];
  for (let rowIdx = 0; rowIdx < next.rows.length; rowIdx++) {
    if (!rowSet.has(rowIdx)) continue;
    const row = next.rows[rowIdx]!;
    row.cells = row.cells.map((value) => {
      if (value.startsWith("=")) return value; // never touch formulas
      const trimmed = value.trim();
      if (trimmed !== value) {
        affected++;
        if (samples.length < 3) samples.push(`"${value}" → "${trimmed}"`);
      }
      return trimmed;
    });
  }
  return { next: affected ? next : document, preview: { affected, samples } };
}

/** Remove rows (within the target set) whose every real cell is empty. */
export function removeBlankRowsIn(
  document: SpreadsheetDocument,
  targetRows: number[],
  headerMode: boolean,
): { next: SpreadsheetDocument; preview: CleanupPreview } {
  const rowSet = new Set(targetRows);
  const removed: number[] = [];
  const kept = document.rows.filter((row, rowIdx) => {
    if (headerMode && rowIdx === 0) return true;
    if (!rowSet.has(rowIdx)) return true;
    const blank = row.cells.every((value) => value.trim() === "");
    if (blank) removed.push(rowIdx + 1);
    return !blank;
  });
  if (!removed.length) return { next: document, preview: { affected: 0, samples: [] } };
  const next = cloneDocument(document);
  next.rows = kept.map((row) => ({ ...row, cells: [...row.cells] }));
  if (!next.rows.length) next.rows.push(createRow([""]));
  return {
    next,
    preview: { affected: removed.length, samples: removed.slice(0, 3).map((n) => `Row ${n}`) },
  };
}

/**
 * Remove duplicate rows within the target set, comparing the raw string values
 * of the given key columns, keeping the first occurrence.
 */
export function removeDuplicateRowsIn(options: {
  document: SpreadsheetDocument;
  targetRows: number[];
  keyColumns: number[];
  headerMode: boolean;
}): { next: SpreadsheetDocument; preview: CleanupPreview } {
  const { document, targetRows, keyColumns, headerMode } = options;
  const rowSet = new Set(targetRows);
  const seen = new Set<string>();
  const removed: number[] = [];
  const kept = document.rows.filter((row, rowIdx) => {
    if (headerMode && rowIdx === 0) return true;
    if (!rowSet.has(rowIdx)) return true;
    const columns = keyColumns.length ? keyColumns : row.cells.map((_, index) => index);
    const key = JSON.stringify(columns.map((column) => row.cells[column] ?? ""));
    if (seen.has(key)) {
      removed.push(rowIdx + 1);
      return false;
    }
    seen.add(key);
    return true;
  });
  if (!removed.length) return { next: document, preview: { affected: 0, samples: [] } };
  const next = cloneDocument(document);
  next.rows = kept.map((row) => ({ ...row, cells: [...row.cells] }));
  if (!next.rows.length) next.rows.push(createRow([""]));
  return {
    next,
    preview: { affected: removed.length, samples: removed.slice(0, 3).map((n) => `Row ${n}`) },
  };
}
