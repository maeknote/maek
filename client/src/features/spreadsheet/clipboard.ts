import type { SpreadsheetDocument } from "./model";
import { normalizeRange, type CellRange } from "./selection";

const quoteTsv = (value: string) => /[\t\r\n"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

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
      else quoted = !quoted;
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
