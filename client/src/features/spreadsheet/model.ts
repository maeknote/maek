import {
  CSV_EDIT_LIMITS,
  checkCsvShape,
  utf8ByteLength,
  type CsvDialect as SharedCsvDialect,
} from "@shared/csv";

/**
 * Shared editing limits, re-exported under the historical `CSV_LIMITS` name.
 * `bytes` was previously only enforced on the server; it is now part of the
 * common contract so client commands can validate serialized size too.
 */
export const CSV_LIMITS = CSV_EDIT_LIMITS;

export type CsvDialect = SharedCsvDialect;

export interface SpreadsheetRow {
  id: string;
  cells: string[];
  fieldCount: number;
}

export interface SpreadsheetDocument {
  rows: SpreadsheetRow[];
  columnCount: number;
  dialect: CsvDialect;
}

let nextRowId = 0;

export function createRow(cells: string[] = [""]): SpreadsheetRow {
  return {
    id: `csv-row-${Date.now().toString(36)}-${nextRowId++}`,
    cells: [...cells],
    fieldCount: cells.length,
  };
}

export function cloneDocument(document: SpreadsheetDocument): SpreadsheetDocument {
  return {
    ...document,
    rows: document.rows.map((row) => ({ ...row, cells: [...row.cells] })),
  };
}

export function columnLabel(index: number): string {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    value--;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

export function documentShape(document: SpreadsheetDocument) {
  return {
    rows: document.rows.length,
    columns: document.columnCount,
    fields: document.rows.reduce((sum, row) => sum + row.fieldCount, 0),
  };
}

/** The longest cell in the document, used for the per-cell character limit. */
export function longestCell(document: SpreadsheetDocument): number {
  let longest = 0;
  for (const row of document.rows)
    for (const cell of row.cells) if ((cell?.length ?? 0) > longest) longest = cell?.length ?? 0;
  return longest;
}

export function validateDocument(
  document: SpreadsheetDocument,
  options: { bytes?: number } = {},
): string | null {
  return checkCsvShape(documentShape(document), {
    bytes: options.bytes,
    maxCellChars: longestCell(document),
  });
}

export { utf8ByteLength };
