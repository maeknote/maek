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

/**
 * Multi-range selection model.
 *
 * `ranges` are independent rectangles in document coordinates. `activeCell` is
 * the current input target; `anchor` is the base for Shift-extension. `kinds`
 * annotate whether each range represents a free cell rectangle, a full-row
 * selection, or a full-column selection (for row/column operations).
 *
 * Under an active filter a visually contiguous selection may map to a set of
 * non-adjacent document rows, so the resolved targets are computed against the
 * visible-row order rather than a raw min..max document-row span.
 */
export type RangeKind = "cell" | "row" | "column";

export interface SelectionRange extends CellRange {
  kind: RangeKind;
}

export interface SelectionModel {
  activeCell: CellPosition;
  anchor: CellPosition;
  ranges: SelectionRange[];
}

export function singleSelection(position: CellPosition, kind: RangeKind = "cell"): SelectionModel {
  return {
    activeCell: position,
    anchor: position,
    ranges: [{ anchor: position, focus: position, kind }],
  };
}

/** Whether any range in the model contains the given document cell. */
export function selectionContains(model: SelectionModel, rowIdx: number, colIdx: number): boolean {
  return model.ranges.some((range) => containsCell(range, rowIdx, colIdx));
}

/**
 * Resolve the distinct document cells covered by the selection, honoring the
 * visible-row order under a filter. `visibleRows` is the ordered list of
 * document row indexes currently shown; when unfiltered it is every row in
 * order. Cells outside the visible set are excluded, and overlapping ranges are
 * de-duplicated so statistics and deletes never double-count.
 */
export function resolveSelectionCells(
  model: SelectionModel,
  visibleRows: number[],
  columnCount: number,
): CellPosition[] {
  const visibleSet = new Set(visibleRows);
  const seen = new Set<string>();
  const cells: CellPosition[] = [];
  for (const range of model.ranges) {
    const { top, bottom, left, right } = normalizeRange(range);
    for (let rowIdx = top; rowIdx <= bottom; rowIdx++) {
      if (!visibleSet.has(rowIdx)) continue;
      for (let colIdx = Math.max(0, left); colIdx <= Math.min(columnCount - 1, right); colIdx++) {
        const key = `${rowIdx}:${colIdx}`;
        if (seen.has(key)) continue;
        seen.add(key);
        cells.push({ rowIdx, colIdx });
      }
    }
  }
  return cells;
}

/** The distinct visible document row indexes touched by the selection. */
export function resolveSelectionRows(model: SelectionModel, visibleRows: number[]): number[] {
  const visibleSet = new Set(visibleRows);
  const seen = new Set<number>();
  const rows: number[] = [];
  for (const range of model.ranges) {
    const { top, bottom } = normalizeRange(range);
    for (let rowIdx = top; rowIdx <= bottom; rowIdx++) {
      if (!visibleSet.has(rowIdx) || seen.has(rowIdx)) continue;
      seen.add(rowIdx);
      rows.push(rowIdx);
    }
  }
  // Return in visible order for stable, filter-aware operations.
  return visibleRows.filter((rowIdx) => seen.has(rowIdx));
}

/**
 * Toggle a single cell out of the selection: if it is currently covered,
 * rebuild the covering range as up to four surrounding rectangles so the
 * remaining area stays selected. Returns the new range list.
 */
export function removeCellFromRanges(ranges: SelectionRange[], cell: CellPosition): SelectionRange[] {
  const result: SelectionRange[] = [];
  for (const range of ranges) {
    if (!containsCell(range, cell.rowIdx, cell.colIdx)) {
      result.push(range);
      continue;
    }
    const { top, bottom, left, right } = normalizeRange(range);
    // Top band.
    if (cell.rowIdx > top)
      result.push({ anchor: { rowIdx: top, colIdx: left }, focus: { rowIdx: cell.rowIdx - 1, colIdx: right }, kind: "cell" });
    // Bottom band.
    if (cell.rowIdx < bottom)
      result.push({ anchor: { rowIdx: cell.rowIdx + 1, colIdx: left }, focus: { rowIdx: bottom, colIdx: right }, kind: "cell" });
    // Left band (only the affected row band).
    if (cell.colIdx > left)
      result.push({ anchor: { rowIdx: cell.rowIdx, colIdx: left }, focus: { rowIdx: cell.rowIdx, colIdx: cell.colIdx - 1 }, kind: "cell" });
    // Right band.
    if (cell.colIdx < right)
      result.push({ anchor: { rowIdx: cell.rowIdx, colIdx: cell.colIdx + 1 }, focus: { rowIdx: cell.rowIdx, colIdx: right }, kind: "cell" });
  }
  return result;
}

/** True when the selection is a single contiguous rectangle (for copy/fill). */
export function isSingleRectangle(model: SelectionModel): boolean {
  return model.ranges.length === 1;
}
