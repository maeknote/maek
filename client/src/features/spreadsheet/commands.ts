import { CSV_LIMITS, cloneDocument, createRow, validateDocument, type SpreadsheetDocument } from "./model";
import { normalizeRange, type CellPosition, type CellRange } from "./selection";

export function setCell(document: SpreadsheetDocument, position: CellPosition, value: string): SpreadsheetDocument {
  const next = cloneDocument(document);
  const row = next.rows[position.rowIdx];
  if (!row) return document;
  row.cells[position.colIdx] = value;
  row.fieldCount = Math.max(row.fieldCount, position.colIdx + 1);
  next.columnCount = Math.max(next.columnCount, position.colIdx + 1);
  return next;
}

export function clearRange(document: SpreadsheetDocument, range: CellRange): SpreadsheetDocument {
  const next = cloneDocument(document);
  const { top, bottom, left, right } = normalizeRange(range);
  for (let rowIdx = top; rowIdx <= bottom; rowIdx++) {
    const row = next.rows[rowIdx];
    if (!row) continue;
    for (let colIdx = left; colIdx <= right; colIdx++) row.cells[colIdx] = "";
    row.fieldCount = Math.max(row.fieldCount, right + 1);
  }
  return next;
}

export function pasteMatrix(document: SpreadsheetDocument, start: CellPosition, matrix: string[][]): SpreadsheetDocument {
  const height = matrix.length;
  const width = Math.max(0, ...matrix.map((row) => row.length));
  if (start.rowIdx + height > CSV_LIMITS.rows || start.colIdx + width > CSV_LIMITS.columns)
    throw new Error("Paste exceeds the CSV editing limits");
  const next = cloneDocument(document);
  while (next.rows.length < start.rowIdx + height) next.rows.push(createRow([""]));
  next.columnCount = Math.max(next.columnCount, start.colIdx + width);
  matrix.forEach((values, rowOffset) => {
    const row = next.rows[start.rowIdx + rowOffset]!;
    values.forEach((value, colOffset) => { row.cells[start.colIdx + colOffset] = value; });
    row.fieldCount = Math.max(row.fieldCount, start.colIdx + values.length);
  });
  const error = validateDocument(next);
  if (error) throw new Error(error);
  return next;
}

export function insertRow(document: SpreadsheetDocument, index: number): SpreadsheetDocument {
  if (document.rows.length >= CSV_LIMITS.rows) throw new Error("Row limit reached");
  const next = cloneDocument(document);
  next.rows.splice(Math.max(0, index), 0, createRow(Array(next.columnCount).fill("")));
  return next;
}

export function deleteRow(document: SpreadsheetDocument, index: number): SpreadsheetDocument {
  const next = cloneDocument(document);
  next.rows.splice(index, 1);
  if (!next.rows.length) next.rows.push(createRow([""]));
  return next;
}

export function insertColumn(document: SpreadsheetDocument, index: number): SpreadsheetDocument {
  if (document.columnCount >= CSV_LIMITS.columns) throw new Error("Column limit reached");
  const next = cloneDocument(document);
  next.rows.forEach((row) => { row.cells.splice(index, 0, ""); row.fieldCount++; });
  next.columnCount++;
  return next;
}

export function deleteColumn(document: SpreadsheetDocument, index: number): SpreadsheetDocument {
  const next = cloneDocument(document);
  next.rows.forEach((row) => {
    if (index < row.fieldCount) row.fieldCount--;
    row.cells.splice(index, 1);
    if (!row.cells.length) row.cells.push("");
  });
  next.columnCount = Math.max(1, next.columnCount - 1);
  return next;
}

export function sortRows(document: SpreadsheetDocument, column: number, direction: "ASC" | "DESC", headerMode: boolean): SpreadsheetDocument {
  const next = cloneDocument(document);
  const head = headerMode ? next.rows.splice(0, 1) : [];
  next.rows = next.rows.map((row, index) => ({ row, index })).sort((a, b) => {
    const compared = (a.row.cells[column] ?? "").localeCompare(b.row.cells[column] ?? "", undefined, { numeric: true, sensitivity: "base" });
    return (direction === "ASC" ? compared : -compared) || a.index - b.index;
  }).map(({ row }) => row);
  next.rows.unshift(...head);
  return next;
}
