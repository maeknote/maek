import {
  clearRange,
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  pasteMatrix,
  removeBlankRows,
  removeDuplicateRows,
  replaceText,
  setCell,
  sortRowsByColumns,
  trimCells,
} from "./commands";
import { serializeCsv } from "./csv-codec";
import { utf8ByteLength, validateDocument, type SpreadsheetDocument } from "./model";
import { CSV_EDIT_LIMITS } from "@shared/csv";
import type { CellPosition, CellRange } from "./selection";

/**
 * The set of document-mutating commands. Every user edit funnels through one
 * of these so the session can validate, snapshot, and serialize uniformly.
 */
export type SheetCommand =
  | { type: "set-cell"; position: CellPosition; value: string }
  | { type: "clear-range"; range: CellRange }
  | { type: "paste"; start: CellPosition; matrix: string[][] }
  | { type: "insert-row"; index: number }
  | { type: "delete-row"; index: number }
  | { type: "insert-column"; index: number }
  | { type: "delete-column"; index: number }
  | { type: "sort"; columns: { column: number; direction: "ASC" | "DESC" }[]; headerMode: boolean }
  | { type: "replace-text"; search: string; replacement: string }
  | { type: "trim-cells" }
  | { type: "remove-blank-rows"; headerMode: boolean }
  | { type: "remove-duplicate-rows"; headerMode: boolean };

/** Apply a command to a document, returning the next (possibly identical) document. */
export function applyCommand(document: SpreadsheetDocument, command: SheetCommand): SpreadsheetDocument {
  switch (command.type) {
    case "set-cell":
      return setCell(document, command.position, command.value);
    case "clear-range":
      return clearRange(document, command.range);
    case "paste":
      return pasteMatrix(document, command.start, command.matrix);
    case "insert-row":
      return insertRow(document, command.index);
    case "delete-row":
      return deleteRow(document, command.index);
    case "insert-column":
      return insertColumn(document, command.index);
    case "delete-column":
      return deleteColumn(document, command.index);
    case "sort":
      return sortRowsByColumns(document, command.columns, command.headerMode);
    case "replace-text":
      return replaceText(document, command.search, command.replacement);
    case "trim-cells":
      return trimCells(document);
    case "remove-blank-rows":
      return removeBlankRows(document, command.headerMode);
    case "remove-duplicate-rows":
      return removeDuplicateRows(document, command.headerMode);
  }
}

export interface TransactionSuccess {
  ok: true;
  /** True when the command produced no change (no revision/undo/dirty). */
  noop: boolean;
  next: SpreadsheetDocument;
  serialized: string;
}

export interface TransactionFailure {
  ok: false;
  reason: string;
}

export type TransactionResult = TransactionSuccess | TransactionFailure;

/**
 * Run a command as an atomic transaction:
 *   apply → limit validation → serialize → byte validation.
 * On any failure the original document is untouched (commands are pure and
 * return new documents), so callers keep their prior state and save string.
 */
export function runTransaction(
  document: SpreadsheetDocument,
  command: SheetCommand,
): TransactionResult {
  let next: SpreadsheetDocument;
  try {
    next = applyCommand(document, command);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  if (next === document) {
    return { ok: true, noop: true, next: document, serialized: serializeCsv(document) };
  }
  const shapeError = validateDocument(next);
  if (shapeError) return { ok: false, reason: shapeError };
  const serialized = serializeCsv(next);
  const bytes = utf8ByteLength(serialized);
  if (bytes > CSV_EDIT_LIMITS.bytes) return { ok: false, reason: "CSV files must be 5 MiB or smaller" };
  return { ok: true, noop: false, next, serialized };
}
