import { columnLabel, type SpreadsheetDocument } from "./model";

/** A per-column filter condition. Different conditions on one column are OR'd. */
export interface ColumnFilter {
  /** Explicit set of accepted display values (OR within the column). */
  values?: string[];
  /** Accept only empty cells. */
  empty?: boolean;
  /** Accept only non-empty cells. */
  nonEmpty?: boolean;
  /** Case-insensitive substring match on the display value. */
  contains?: string;
  /** Numeric comparison against the parsed display value. */
  numeric?: { op: ">" | ">=" | "<" | "<=" | "=" | "!="; value: number };
}

/** Map of data-column index → filter. Different columns are AND'd. */
export type ColumnFilters = Record<number, ColumnFilter>;

function matchesFilter(displayValue: string, filter: ColumnFilter): boolean {
  const clauses: boolean[] = [];
  if (filter.values && filter.values.length) clauses.push(filter.values.includes(displayValue));
  if (filter.empty) clauses.push(displayValue === "");
  if (filter.nonEmpty) clauses.push(displayValue !== "");
  if (filter.contains) clauses.push(displayValue.toLocaleLowerCase().includes(filter.contains.toLocaleLowerCase()));
  if (filter.numeric) {
    const parsed = Number(displayValue);
    if (Number.isFinite(parsed)) {
      const { op, value } = filter.numeric;
      clauses.push(
        op === ">" ? parsed > value :
        op === ">=" ? parsed >= value :
        op === "<" ? parsed < value :
        op === "<=" ? parsed <= value :
        op === "=" ? parsed === value :
        parsed !== value,
      );
    } else clauses.push(false);
  }
  // No active clause means the column filter accepts everything.
  if (!clauses.length) return true;
  // Conditions within one column are OR'd.
  return clauses.some(Boolean);
}

/**
 * Compute the ordered list of visible document row indexes given the active
 * column filters. `getDisplayValue(rowIdx, colIdx)` returns the value used for
 * matching: the raw cell for plain strings, the calculated value for formulas.
 * The header row (document row 0 in header mode) is always kept visible.
 */
export function computeVisibleRows(options: {
  document: SpreadsheetDocument;
  filters: ColumnFilters;
  headerMode: boolean;
  getDisplayValue: (rowIdx: number, colIdx: number) => string;
}): number[] {
  const { document, filters, headerMode, getDisplayValue } = options;
  const active = Object.entries(filters).filter(([, filter]) => hasActiveClause(filter));
  const visible: number[] = [];
  for (let rowIdx = 0; rowIdx < document.rows.length; rowIdx++) {
    if (headerMode && rowIdx === 0) {
      visible.push(rowIdx);
      continue;
    }
    const keep = active.every(([column, filter]) =>
      matchesFilter(getDisplayValue(rowIdx, Number(column)), filter),
    );
    if (keep) visible.push(rowIdx);
  }
  return visible;
}

export function hasActiveClause(filter: ColumnFilter): boolean {
  return Boolean(
    (filter.values && filter.values.length) ||
      filter.empty ||
      filter.nonEmpty ||
      filter.contains ||
      filter.numeric,
  );
}

export function isFiltered(filters: ColumnFilters): boolean {
  return Object.values(filters).some(hasActiveClause);
}

/**
 * The display name for a data column: the first row's value in header mode
 * (falling back to the column letter when empty), otherwise the column letter.
 */
export function columnDisplayName(document: SpreadsheetDocument, column: number, headerMode: boolean): string {
  if (headerMode) {
    const headerValue = document.rows[0]?.cells[column];
    if (headerValue && headerValue.trim() !== "") return headerValue;
  }
  return columnLabel(column);
}

/** Distinct display values in a column (for the value-picker list). */
export function distinctColumnValues(options: {
  document: SpreadsheetDocument;
  column: number;
  headerMode: boolean;
  getDisplayValue: (rowIdx: number, colIdx: number) => string;
}): string[] {
  const { document, column, headerMode, getDisplayValue } = options;
  const seen = new Set<string>();
  const values: string[] = [];
  for (let rowIdx = headerMode ? 1 : 0; rowIdx < document.rows.length; rowIdx++) {
    const value = getDisplayValue(rowIdx, column);
    if (seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values;
}
