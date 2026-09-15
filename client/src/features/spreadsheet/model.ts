export const CSV_LIMITS = {
  rows: 50_000,
  columns: 200,
  fields: 500_000,
  cellChars: 100_000,
} as const;

export interface CsvDialect {
  delimiter: "," | "\t" | ";";
  newline: "\n" | "\r\n";
  bom: boolean;
}

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

export function validateDocument(document: SpreadsheetDocument): string | null {
  const shape = documentShape(document);
  if (shape.rows > CSV_LIMITS.rows) return `CSV exceeds ${CSV_LIMITS.rows.toLocaleString()} rows`;
  if (shape.columns > CSV_LIMITS.columns) return `CSV exceeds ${CSV_LIMITS.columns} columns`;
  if (shape.fields > CSV_LIMITS.fields) return `CSV exceeds ${CSV_LIMITS.fields.toLocaleString()} fields`;
  if (document.rows.some((row) => row.cells.some((cell) => cell.length > CSV_LIMITS.cellChars)))
    return `A cell exceeds ${CSV_LIMITS.cellChars.toLocaleString()} characters`;
  return null;
}
