import { CSV_LIMITS, cloneDocument, createRow, validateDocument, type SpreadsheetDocument } from "./model";
import { normalizeRange, type CellPosition, type CellRange } from "./selection";
import { shiftFormulaReferences } from "./formula-references";

function shiftDocumentFormulas(document: SpreadsheetDocument, axis: "row" | "column", boundary: number, delta: -1 | 1) {
  for (const row of document.rows) row.cells = row.cells.map((value) => shiftFormulaReferences(value, axis, boundary, delta));
}

export function setCell(document: SpreadsheetDocument, position: CellPosition, value: string): SpreadsheetDocument {
  const existing = document.rows[position.rowIdx];
  // Writing an empty value into a virtual (non-existent) cell must not
  // materialize document rows or fields. Only real content grows the document.
  if (value === "") {
    if (!existing) return document;
    if ((existing.cells[position.colIdx] ?? "") === "") return document;
  } else if (position.rowIdx >= CSV_LIMITS.rows || position.colIdx >= CSV_LIMITS.columns) {
    throw new Error("Cell position exceeds the CSV editing limits");
  }
  const next = cloneDocument(document);
  // Materialize any intervening rows when writing into a virtual position.
  while (next.rows.length <= position.rowIdx) next.rows.push(createRow([""]));
  const row = next.rows[position.rowIdx]!;
  // Fill any gap between the row's current cells and the target column so the
  // cells array stays dense (no holes) for serialization and validation.
  for (let colIdx = row.cells.length; colIdx < position.colIdx; colIdx++) row.cells[colIdx] = "";
  row.cells[position.colIdx] = value;
  // Only extend the field/column count for a non-empty value, or when the
  // position already sits inside the row's existing fields.
  if (value !== "" || position.colIdx < row.fieldCount) {
    row.fieldCount = Math.max(row.fieldCount, position.colIdx + 1);
    next.columnCount = Math.max(next.columnCount, position.colIdx + 1);
  }
  const error = validateDocument(next);
  if (error) throw new Error(error);
  return next;
}

export function clearRange(document: SpreadsheetDocument, range: CellRange): SpreadsheetDocument {
  const { top, bottom, left, right } = normalizeRange(range);
  const next = cloneDocument(document);
  let changed = false;
  for (let rowIdx = top; rowIdx <= bottom; rowIdx++) {
    const row = next.rows[rowIdx];
    if (!row) continue;
    // Only clear cells that actually exist; clearing beyond fieldCount is a
    // no-op and must never grow the row (that would corrupt A1-style layout).
    const limit = Math.min(right, row.fieldCount - 1);
    for (let colIdx = left; colIdx <= limit; colIdx++) {
      if ((row.cells[colIdx] ?? "") !== "") {
        row.cells[colIdx] = "";
        changed = true;
      }
    }
  }
  return changed ? next : document;
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
  const insertion = Math.max(0, Math.min(index, next.rows.length));
  shiftDocumentFormulas(next, "row", insertion + 1, 1);
  next.rows.splice(insertion, 0, createRow(Array(next.columnCount).fill("")));
  return next;
}

export function deleteRow(document: SpreadsheetDocument, index: number): SpreadsheetDocument {
  const next = cloneDocument(document);
  if (index >= 0 && index < next.rows.length) shiftDocumentFormulas(next, "row", index + 1, -1);
  next.rows.splice(index, 1);
  if (!next.rows.length) next.rows.push(createRow([""]));
  return next;
}

export function insertColumn(document: SpreadsheetDocument, index: number): SpreadsheetDocument {
  if (document.columnCount >= CSV_LIMITS.columns) throw new Error("Column limit reached");
  const next = cloneDocument(document);
  const insertion = Math.max(0, Math.min(index, document.columnCount));
  shiftDocumentFormulas(next, "column", insertion + 1, 1);
  next.rows.forEach((row) => {
    if (insertion > row.fieldCount) return;
    row.cells.splice(insertion, 0, "");
    row.fieldCount++;
  });
  next.columnCount++;
  return next;
}

export function deleteColumn(document: SpreadsheetDocument, index: number): SpreadsheetDocument {
  const next = cloneDocument(document);
  if (index >= 0 && index < next.columnCount) shiftDocumentFormulas(next, "column", index + 1, -1);
  next.rows.forEach((row) => {
    if (index < row.fieldCount) row.fieldCount--;
    row.cells.splice(index, 1);
    if (!row.cells.length) row.cells.push("");
  });
  next.columnCount = Math.max(1, next.columnCount - 1);
  return next;
}

export function sortRows(document: SpreadsheetDocument, column: number, direction: "ASC" | "DESC", headerMode: boolean): SpreadsheetDocument {
  return sortRowsByColumns(document, [{ column, direction }], headerMode);
}

export function sortRowsByColumns(document: SpreadsheetDocument, sortColumns: { column: number; direction: "ASC" | "DESC" }[], headerMode: boolean): SpreadsheetDocument {
  const next = cloneDocument(document);
  const head = headerMode ? next.rows.splice(0, 1) : [];
  next.rows = next.rows.map((row, index) => ({ row, index })).sort((a, b) => {
    for (const { column, direction } of sortColumns) {
      const compared = (a.row.cells[column] ?? "").localeCompare(b.row.cells[column] ?? "", undefined, { numeric: true, sensitivity: "base" });
      if (compared) return direction === "ASC" ? compared : -compared;
    }
    return a.index - b.index;
  }).map(({ row }) => row);
  next.rows.unshift(...head);
  return next;
}

export function replaceText(document: SpreadsheetDocument, search: string, replacement: string): SpreadsheetDocument {
  if (!search) return document;
  const next = cloneDocument(document);
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(escaped, "gi");
  for (const row of next.rows) row.cells = row.cells.map((value) => value.replace(pattern, replacement));
  return next;
}

export function trimCells(document: SpreadsheetDocument): SpreadsheetDocument {
  const next = cloneDocument(document);
  for (const row of next.rows) row.cells = row.cells.map((value) => value.trim());
  return next;
}

export function removeBlankRows(document: SpreadsheetDocument, headerMode = false): SpreadsheetDocument {
  const next = cloneDocument(document);
  const header = headerMode ? next.rows.shift() : undefined;
  next.rows = next.rows.filter((row) => row.cells.some((value) => value.trim() !== ""));
  if (header) next.rows.unshift(header);
  if (!next.rows.length && !header) next.rows.push(createRow([""]));
  return next;
}

export function removeDuplicateRows(document: SpreadsheetDocument, headerMode = false): SpreadsheetDocument {
  const next = cloneDocument(document);
  const header = headerMode ? next.rows.shift() : undefined;
  const seen = new Set<string>();
  next.rows = next.rows.filter((row) => {
    const key = JSON.stringify(Array.from({ length: row.fieldCount }, (_, index) => row.cells[index] ?? ""));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (header) next.rows.unshift(header);
  if (!next.rows.length) next.rows.push(createRow([""]));
  return next;
}
