import Papa from "papaparse";
import { CSV_EDIT_LIMITS, checkCsvShape, detectDelimiter } from "../../../shared/csv";

export { CSV_EDIT_LIMITS };

export function validateCsvForEditing(content: string): string | null {
  if (Buffer.byteLength(content, "utf8") > CSV_EDIT_LIMITS.bytes) return "CSV files must be 5 MiB or smaller";
  const source = content.startsWith("\uFEFF") ? content.slice(1) : content;
  const result = Papa.parse<string[]>(source, {
    delimiter: detectDelimiter(source),
    header: false,
    dynamicTyping: false,
    skipEmptyLines: false,
  });
  const malformed = result.errors.find((error) => error.code === "MissingQuotes");
  if (malformed) return `CSV could not be parsed safely: ${malformed.message}`;
  const rows = result.data.length || 1;
  let fields = 0;
  let columns = 1;
  let maxCellChars = 0;
  for (const row of result.data) {
    fields += row.length;
    columns = Math.max(columns, row.length);
    for (const cell of row) {
      const length = String(cell ?? "").length;
      if (length > maxCellChars) maxCellChars = length;
    }
  }
  return checkCsvShape({ rows, columns, fields }, { maxCellChars });
}
