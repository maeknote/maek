import Papa, { type ParseError } from "papaparse";
import {
  CSV_LIMITS,
  createRow,
  validateDocument,
  type CsvDialect,
  type SpreadsheetDocument,
} from "./model";

export interface CsvParseResult {
  document: SpreadsheetDocument;
  readonlyReason: string | null;
  warnings: string[];
}

function detectDelimiter(source: string): CsvDialect["delimiter"] {
  const counts = new Map<CsvDialect["delimiter"], number>([[",", 0], ["\t", 0], [";", 0]]);
  let quoted = false;
  for (let index = 0; index < Math.min(source.length, 64_000); index++) {
    const char = source[index]!;
    if (char === '"') {
      if (quoted && source[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if ([...counts.values()].some(Boolean)) break;
    } else if (!quoted && counts.has(char as CsvDialect["delimiter"])) {
      const delimiter = char as CsvDialect["delimiter"];
      counts.set(delimiter, counts.get(delimiter)! + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ",";
}

function isFatal(error: ParseError): boolean {
  return error.code === "MissingQuotes" || error.code === "TooFewFields" || error.code === "TooManyFields";
}

export function parseCsv(raw: string): CsvParseResult {
  const bom = raw.startsWith("\uFEFF");
  const source = bom ? raw.slice(1) : raw;
  const dialect: CsvDialect = {
    delimiter: detectDelimiter(source),
    newline: source.includes("\r\n") ? "\r\n" : "\n",
    bom,
  };
  const parsed = Papa.parse<string[]>(source, {
    delimiter: dialect.delimiter,
    newline: dialect.newline,
    header: false,
    dynamicTyping: false,
    skipEmptyLines: false,
  });
  const data = parsed.data.length ? parsed.data : [[""]];
  const document: SpreadsheetDocument = {
    rows: data.map((cells) => createRow(cells.map((cell) => String(cell ?? "")))),
    columnCount: Math.max(1, ...data.map((row) => row.length)),
    dialect,
  };
  const shapeError = validateDocument(document);
  const fatal = parsed.errors.find(isFatal);
  const warnings = parsed.errors
    .filter((error) => error.code !== "UndetectableDelimiter")
    .map((error) => `Row ${(error.row ?? 0) + 1}: ${error.message}`);
  return {
    document,
    readonlyReason: fatal ? `CSV could not be parsed safely: ${fatal.message}` : shapeError,
    warnings,
  };
}

export function serializeCsv(document: SpreadsheetDocument): string {
  const data = document.rows.map((row) =>
    Array.from({ length: row.fieldCount }, (_, index) => row.cells[index] ?? ""),
  );
  const content = Papa.unparse(data, {
    delimiter: document.dialect.delimiter,
    newline: document.dialect.newline,
    quotes: false,
  });
  return (document.dialect.bom ? "\uFEFF" : "") + content;
}

export { CSV_LIMITS };
