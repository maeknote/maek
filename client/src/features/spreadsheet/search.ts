import type { SpreadsheetDocument } from "./model";

export interface SearchOptions {
  query: string;
  caseSensitive: boolean;
  /** Search the raw cell/formula text instead of the display value. */
  formulaText: boolean;
}

export interface SearchMatch {
  rowIdx: number;
  colIdx: number;
}

/**
 * Find all matches. `getDisplayValue` returns the calculated/plain value used
 * in display-value mode; raw cell text is used in formula-text mode. The header
 * row is included in results (callers decide whether to skip it for replace).
 */
export function findMatches(options: {
  document: SpreadsheetDocument;
  search: SearchOptions;
  visibleRows: number[] | null;
  getDisplayValue: (rowIdx: number, colIdx: number) => string;
}): SearchMatch[] {
  const { document, search, visibleRows, getDisplayValue } = options;
  if (!search.query) return [];
  const needle = search.caseSensitive ? search.query : search.query.toLocaleLowerCase();
  const rows = visibleRows ?? document.rows.map((_, index) => index);
  const matches: SearchMatch[] = [];
  for (const rowIdx of rows) {
    const row = document.rows[rowIdx];
    if (!row) continue;
    const width = Math.max(row.fieldCount, document.columnCount);
    for (let colIdx = 0; colIdx < width; colIdx++) {
      const value = search.formulaText ? row.cells[colIdx] ?? "" : getDisplayValue(rowIdx, colIdx);
      const haystack = search.caseSensitive ? value : value.toLocaleLowerCase();
      if (needle && haystack.includes(needle)) matches.push({ rowIdx, colIdx });
    }
  }
  return matches;
}

/**
 * Replace occurrences of a literal search string with a literal replacement.
 * The replacement is inserted verbatim — sequences like `$&` or `$1` are kept
 * as literal characters, never interpreted as regex backreferences.
 */
export function replaceLiteral(source: string, search: string, replacement: string, caseSensitive: boolean): string {
  if (!search) return source;
  let result = "";
  let index = 0;
  const haystack = caseSensitive ? source : source.toLocaleLowerCase();
  const needle = caseSensitive ? search : search.toLocaleLowerCase();
  while (index <= source.length - needle.length) {
    if (haystack.startsWith(needle, index)) {
      result += replacement;
      index += needle.length;
    } else {
      result += source[index];
      index++;
    }
  }
  result += source.slice(index);
  return result;
}
