export interface CellPosition {
  rowIdx: number;
  colIdx: number;
}

export interface CellRange {
  anchor: CellPosition;
  focus: CellPosition;
}

export interface NormalizedRange {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function normalizeRange(range: CellRange): NormalizedRange {
  return {
    top: Math.min(range.anchor.rowIdx, range.focus.rowIdx),
    bottom: Math.max(range.anchor.rowIdx, range.focus.rowIdx),
    left: Math.min(range.anchor.colIdx, range.focus.colIdx),
    right: Math.max(range.anchor.colIdx, range.focus.colIdx),
  };
}

export function containsCell(range: CellRange, rowIdx: number, colIdx: number): boolean {
  const normalized = normalizeRange(range);
  return rowIdx >= normalized.top && rowIdx <= normalized.bottom && colIdx >= normalized.left && colIdx <= normalized.right;
}
