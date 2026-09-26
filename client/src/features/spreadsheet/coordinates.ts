import type { SpreadsheetDocument } from "./model";

/**
 * The default minimum interactive grid size. The sheet always presents at
 * least this many rows/columns so users can type into empty space, even when
 * the underlying CSV is smaller. Virtual cells beyond the document are not
 * materialized until real content is written.
 */
export const MIN_VISIBLE_ROWS = 100;
export const MIN_VISIBLE_COLUMNS = 26;
/** Growth granularity when scrolling near the current edge. */
export const ROW_GROWTH_STEP = 100;
export const COLUMN_GROWTH_STEP = 26;

/**
 * A row visible in the grid, in display order. `documentIndex` is the 0-based
 * position in the CSV document; `-1` marks a purely virtual row that has no
 * backing document row yet.
 */
export interface DisplayRow {
  /** Stable key for React and RDG. */
  key: string;
  /** 0-based document row index, or -1 for a virtual (unmaterialized) row. */
  documentIndex: number;
  /** 1-based row number shown in the row-number gutter. */
  rowNumber: number;
  /** True when this is the header row (document row 0 in header mode). */
  isHeader: boolean;
}

export interface GridShape {
  /** Number of interactive rows (max of document rows and the visible floor). */
  rowCount: number;
  /** Number of interactive data columns. */
  columnCount: number;
}

/**
 * Compute the interactive grid shape: at least the visible floor, at least the
 * document size, and rounded up to the growth step so scrolling reveals a full
 * new band. Never exceeds the editing limits.
 */
export function computeGridShape(
  document: SpreadsheetDocument,
  options: { extraRows?: number; extraColumns?: number; maxRows: number; maxColumns: number },
): GridShape {
  const docRows = document.rows.length;
  const docColumns = document.columnCount;
  const desiredRows = Math.max(MIN_VISIBLE_ROWS, docRows) + (options.extraRows ?? 0);
  const desiredColumns = Math.max(MIN_VISIBLE_COLUMNS, docColumns) + (options.extraColumns ?? 0);
  return {
    rowCount: Math.min(options.maxRows, desiredRows),
    columnCount: Math.min(options.maxColumns, desiredColumns),
  };
}

/** RDG uses column key 0 for the row-number gutter; data column A is key 1. */
export function dataColumnToGridColumn(dataColumn: number): number {
  return dataColumn + 1;
}

export function gridColumnToDataColumn(gridColumn: number): number {
  return gridColumn - 1;
}

/**
 * Build the ordered list of display rows given the visible document rows (after
 * filtering) plus the interactive floor. `visibleDocumentIndexes` is the set of
 * document row indexes that pass the current filter, in display order; when no
 * filter is active it is simply every document row in order.
 */
export function buildDisplayRows(options: {
  document: SpreadsheetDocument;
  visibleDocumentIndexes: number[];
  gridRowCount: number;
  headerMode: boolean;
  filtered: boolean;
}): DisplayRow[] {
  const { document, visibleDocumentIndexes, gridRowCount, headerMode, filtered } = options;
  const rows: DisplayRow[] = [];
  for (const documentIndex of visibleDocumentIndexes) {
    const docRow = document.rows[documentIndex];
    rows.push({
      key: docRow ? docRow.id : `virtual-${documentIndex}`,
      documentIndex,
      rowNumber: documentIndex + 1,
      isHeader: headerMode && documentIndex === 0,
    });
  }
  // Append virtual rows only when not filtering (filters hide document rows and
  // must not fabricate phantom rows between them).
  if (!filtered) {
    for (let index = document.rows.length; index < gridRowCount; index++) {
      rows.push({
        key: `virtual-${index}`,
        documentIndex: index,
        rowNumber: index + 1,
        isHeader: false,
      });
    }
  }
  return rows;
}

/** Every document row index in order, honoring header-mode exclusion for tools. */
export function allDocumentIndexes(document: SpreadsheetDocument): number[] {
  return document.rows.map((_, index) => index);
}
