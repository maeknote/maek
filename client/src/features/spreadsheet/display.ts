import type { SpreadsheetDocument } from "./model";

/**
 * Display rules (plan D-1):
 *  - Plain cells show their original string verbatim.
 *  - Only cells starting with "=" show the calculated result.
 *  - Errors (#REF!, #DIV/0!, …) are shown as-is and flagged.
 *  - A value is right-aligned only when it is a pure number or a numeric
 *    formula result. Strings that merely look numeric (00123, phone numbers,
 *    dates) are never coerced.
 */

export interface DisplayCell {
  /** The text to render. */
  text: string;
  /** True when this cell is a formula (its raw text starts with "="). */
  isFormula: boolean;
  /** True when the displayed value is a formula error. */
  isError: boolean;
  /** True when the value should be right-aligned (numeric). */
  numeric: boolean;
}

const ERROR_RE = /^#[A-Z0-9_/?]+!?$/;

/** A pure number: optional sign, digits, optional single decimal, no leading zeros beyond one. */
function isPureNumber(value: string): boolean {
  if (value === "") return false;
  // Reject values with a leading zero followed by another digit (e.g. 00123),
  // which the user clearly intends as a string identifier.
  if (/^-?0\d/.test(value)) return false;
  // Reject leading/trailing whitespace differences and thousands separators.
  return /^-?(\d+)(\.\d+)?$/.test(value);
}

export function displayCell(rawValue: string, calculatedValue: string): DisplayCell {
  const isFormula = rawValue.startsWith("=");
  if (!isFormula) {
    return {
      text: rawValue,
      isFormula: false,
      isError: false,
      // Plain strings are right-aligned only when they are pure numbers.
      numeric: isPureNumber(rawValue),
    };
  }
  const text = calculatedValue;
  const isError = ERROR_RE.test(text);
  return {
    text,
    isFormula: true,
    isError,
    numeric: !isError && isPureNumber(text),
  };
}

/**
 * Build the display grid: for each document cell, resolve its display text and
 * formatting from the raw value plus the latest calculation result.
 */
export function buildDisplayGrid(document: SpreadsheetDocument, calculated: string[][]): DisplayCell[][] {
  return document.rows.map((row, rowIdx) =>
    Array.from({ length: Math.max(row.fieldCount, document.columnCount) }, (_, colIdx) =>
      displayCell(row.cells[colIdx] ?? "", calculated[rowIdx]?.[colIdx] ?? ""),
    ),
  );
}
