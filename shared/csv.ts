/**
 * Shared CSV editing limits and dialect helpers used by both the client
 * spreadsheet feature and the server CSV validator. Keeping a single source of
 * truth ensures the browser and the Local Core agree on what is editable.
 */

export const CSV_EDIT_LIMITS = {
  /** Serialized UTF-8 byte ceiling. */
  bytes: 5 * 1024 * 1024,
  rows: 50_000,
  columns: 200,
  fields: 500_000,
  cellChars: 100_000,
} as const;

export type CsvDelimiter = "," | "\t" | ";";
export type CsvNewline = "\n" | "\r\n";

export interface CsvDialect {
  delimiter: CsvDelimiter;
  newline: CsvNewline;
  bom: boolean;
}

/**
 * Detect the record delimiter by counting candidate characters that appear
 * outside quoted content, stopping at the first record boundary once a
 * candidate has been seen.
 */
export function detectDelimiter(source: string): CsvDelimiter {
  const counts = new Map<CsvDelimiter, number>([
    [",", 0],
    ["\t", 0],
    [";", 0],
  ]);
  let quoted = false;
  for (let index = 0; index < Math.min(source.length, 64_000); index++) {
    const char = source[index]!;
    if (char === '"') {
      if (quoted && source[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if ([...counts.values()].some(Boolean)) break;
    } else if (!quoted && counts.has(char as CsvDelimiter)) {
      const delimiter = char as CsvDelimiter;
      counts.set(delimiter, counts.get(delimiter)! + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ",";
}

/** Detect the record newline outside quoted cell content. */
export function detectNewline(source: string): CsvNewline {
  let quoted = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (char === '"') {
      if (quoted && source[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (!quoted && (char === "\r" || char === "\n")) {
      return char === "\r" && source[index + 1] === "\n" ? "\r\n" : "\n";
    }
  }
  return "\n";
}

/** Strip a leading UTF-8 BOM, reporting whether one was present. */
export function stripBom(raw: string): { source: string; bom: boolean } {
  const bom = raw.startsWith("\uFEFF");
  return { source: bom ? raw.slice(1) : raw, bom };
}

export interface DocumentShape {
  rows: number;
  columns: number;
  fields: number;
}

/**
 * Validate a shape (and optionally the serialized byte length) against the
 * shared limits, returning a human-readable reason or null when acceptable.
 */
export function checkCsvShape(
  shape: DocumentShape,
  options: { bytes?: number; maxCellChars?: number } = {},
): string | null {
  if (shape.rows > CSV_EDIT_LIMITS.rows)
    return `CSV exceeds ${CSV_EDIT_LIMITS.rows.toLocaleString()} rows`;
  if (shape.columns > CSV_EDIT_LIMITS.columns)
    return `CSV exceeds ${CSV_EDIT_LIMITS.columns} columns`;
  if (shape.fields > CSV_EDIT_LIMITS.fields)
    return `CSV exceeds ${CSV_EDIT_LIMITS.fields.toLocaleString()} fields`;
  if (options.maxCellChars !== undefined && options.maxCellChars > CSV_EDIT_LIMITS.cellChars)
    return `A cell exceeds ${CSV_EDIT_LIMITS.cellChars.toLocaleString()} characters`;
  if (options.bytes !== undefined && options.bytes > CSV_EDIT_LIMITS.bytes)
    return "CSV files must be 5 MiB or smaller";
  return null;
}

/** Byte length of a UTF-8 string without depending on Node's Buffer. */
export function utf8ByteLength(value: string): number {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value).length;
  // Fallback: manual UTF-8 length computation.
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index++;
    } else bytes += 3;
  }
  return bytes;
}
