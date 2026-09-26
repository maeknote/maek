import type { SpreadsheetDocument } from "./model";
import { normalizeRange, type CellRange } from "./selection";

const quoteTsv = (value: string) => /[\t\r\n"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

/**
 * Internal clipboard payload. Copies made inside the grid record the source
 * origin and raw values so a same-document paste can adjust formula references
 * and offer value-only paste. Internal-ness is verified by this token + payload
 * held in memory, never by mere clipboard-string equality.
 */
export const INTERNAL_CLIPBOARD_TOKEN = "maek-sheet-clip-v1";

export interface InternalClipboard {
  token: typeof INTERNAL_CLIPBOARD_TOKEN;
  /** The exact TSV text placed on the system clipboard, for a sanity match. */
  text: string;
  /** Top-left document coordinate of the copied range. */
  origin: { row: number; column: number };
  /** Raw cell/formula strings of the copied range. */
  raw: string[][];
  /** Calculated (display) values, for value-only paste. */
  values: string[][];
  /** Whether this copy is a pending cut (deferred source deletion). */
  cut: boolean;
}

export function rangeToTsv(document: SpreadsheetDocument, range: CellRange): string {
  const { top, bottom, left, right } = normalizeRange(range);
  const lines: string[] = [];
  for (let rowIdx = top; rowIdx <= bottom; rowIdx++) {
    const row = document.rows[rowIdx];
    lines.push(Array.from({ length: right - left + 1 }, (_, offset) => quoteTsv(row?.cells[left + offset] ?? "")).join("\t"));
  }
  return lines.join("\n");
}

export function parseTsv(text: string): string[][] {
  const rows: string[][] = [[]];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index++; }
      else if (quoted) quoted = false;
      else if (value === "") quoted = true;
      else value += char;
    } else if (char === "\t" && !quoted) {
      rows.at(-1)!.push(value); value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index++;
      rows.at(-1)!.push(value); value = ""; rows.push([]);
    } else value += char;
  }
  rows.at(-1)!.push(value);
  if (rows.length > 1 && rows.at(-1)!.length === 1 && rows.at(-1)![0] === "" && /\r?\n$/.test(text)) rows.pop();
  return rows;
}
