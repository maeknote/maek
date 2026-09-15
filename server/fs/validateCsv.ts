import Papa from "papaparse";

export const CSV_EDIT_LIMITS = {
  bytes: 5 * 1024 * 1024,
  rows: 50_000,
  columns: 200,
  fields: 500_000,
  cellChars: 100_000,
} as const;

function delimiterFor(source: string): "," | "\t" | ";" {
  const counts = { ",": 0, "\t": 0, ";": 0 };
  let quoted = false;
  for (let index = 0; index < Math.min(source.length, 64_000); index++) {
    const char = source[index]!;
    if (char === '"') {
      if (quoted && source[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (!quoted && (char === "\r" || char === "\n")) {
      if (Object.values(counts).some(Boolean)) break;
    } else if (!quoted && char in counts) counts[char as keyof typeof counts]++;
  }
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ",") as "," | "\t" | ";";
}

export function validateCsvForEditing(content: string): string | null {
  if (Buffer.byteLength(content, "utf8") > CSV_EDIT_LIMITS.bytes) return "CSV files must be 5 MiB or smaller";
  const source = content.startsWith("\uFEFF") ? content.slice(1) : content;
  const result = Papa.parse<string[]>(source, {
    delimiter: delimiterFor(source),
    header: false,
    dynamicTyping: false,
    skipEmptyLines: false,
  });
  const malformed = result.errors.find((error) => error.code === "MissingQuotes");
  if (malformed) return `CSV could not be parsed safely: ${malformed.message}`;
  const rows = result.data.length || 1;
  if (rows > CSV_EDIT_LIMITS.rows) return `CSV exceeds ${CSV_EDIT_LIMITS.rows.toLocaleString()} rows`;
  let fields = 0;
  let columns = 1;
  for (const row of result.data) {
    fields += row.length;
    columns = Math.max(columns, row.length);
    if (row.some((cell) => String(cell ?? "").length > CSV_EDIT_LIMITS.cellChars))
      return `A cell exceeds ${CSV_EDIT_LIMITS.cellChars.toLocaleString()} characters`;
  }
  if (columns > CSV_EDIT_LIMITS.columns) return `CSV exceeds ${CSV_EDIT_LIMITS.columns} columns`;
  if (fields > CSV_EDIT_LIMITS.fields) return `CSV exceeds ${CSV_EDIT_LIMITS.fields.toLocaleString()} fields`;
  return null;
}
