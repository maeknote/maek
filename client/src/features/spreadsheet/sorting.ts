import type { SpreadsheetDocument } from "./model";

export interface SortCondition {
  column: number;
  direction: "ASC" | "DESC";
}

/**
 * Compare two display values: numeric when both parse as finite numbers,
 * otherwise a locale string comparison. Empty and error values sort last.
 */
function compareValues(a: string, b: string): number {
  const aEmpty = a === "";
  const bEmpty = b === "";
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
  const aError = a.startsWith("#");
  const bError = b.startsWith("#");
  if (aError || bError) return aError === bError ? 0 : aError ? 1 : -1;
  const aNum = Number(a);
  const bNum = Number(b);
  if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Compute a permutation over `targetRows` (a subset of document row indexes, in
 * their current visible order) that sorts them by the given conditions. Returns
 * the target rows reordered; rows outside `targetRows` keep their positions.
 *
 * `getSortValue(rowIdx, colIdx)` returns the calculated value for the sort key
 * (formula results resolved). Ties preserve the original relative order.
 */
export function sortTargetRows(options: {
  targetRows: number[];
  conditions: SortCondition[];
  getSortValue: (rowIdx: number, colIdx: number) => string;
}): number[] {
  const { targetRows, conditions, getSortValue } = options;
  return targetRows
    .map((rowIdx, order) => ({ rowIdx, order }))
    .sort((a, b) => {
      for (const { column, direction } of conditions) {
        const compared = compareValues(getSortValue(a.rowIdx, column), getSortValue(b.rowIdx, column));
        if (compared) return direction === "ASC" ? compared : -compared;
      }
      return a.order - b.order;
    })
    .map((entry) => entry.rowIdx);
}

/**
 * Produce a full document-row permutation array where `permutation[i]` is the
 * document row index that should move into position `i`. Rows not participating
 * in the sort stay at their own index; target positions are filled by the
 * sorted target rows in visible order.
 *
 * This is the shape expected when merging with HyperFormula's setRowOrder in
 * Stage 4 (old row → new position mapping over the whole sheet).
 */
export function buildRowPermutation(options: {
  document: SpreadsheetDocument;
  targetRows: number[];
  sortedTargetRows: number[];
}): number[] {
  const { document, targetRows, sortedTargetRows } = options;
  const permutation = document.rows.map((_, index) => index);
  // The positions occupied by target rows (their current slots) receive the
  // sorted rows in order, leaving every other position untouched.
  const slots = [...targetRows].sort((a, b) => a - b);
  slots.forEach((slot, index) => {
    permutation[slot] = sortedTargetRows[index]!;
  });
  return permutation;
}

/** Apply a row permutation to a document, returning a new row order. */
export function applyRowPermutation(document: SpreadsheetDocument, permutation: number[]): SpreadsheetDocument {
  return {
    ...document,
    rows: permutation.map((sourceIndex) => document.rows[sourceIndex]!).map((row) => ({ ...row, cells: [...row.cells] })),
  };
}
