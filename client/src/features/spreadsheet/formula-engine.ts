import { HyperFormula } from "hyperformula";
import { cloneDocument, type SpreadsheetDocument } from "./model";

/**
 * HyperFormula-backed reference transformation for structural operations.
 *
 * The engine is the source of truth for how formula references shift when rows
 * or columns are inserted/removed or when rows are reordered. We build an
 * engine from the current sheet, run the operation, then merge only the changed
 * *formula* strings back into the document. Plain strings, row ids, fieldCount,
 * and dialect stay owned by the document.
 */

function buildEngine(document: SpreadsheetDocument) {
  const data = document.rows.map((row) =>
    Array.from({ length: document.columnCount }, (_, column) => row.cells[column] ?? ""),
  );
  return HyperFormula.buildFromArray(data, { licenseKey: "gpl-v3" });
}

/** Read a cell's formula string from the engine, falling back to its raw value. */
function engineFormula(engine: HyperFormula, sheetId: number, row: number, col: number): string | null {
  const formula = engine.getCellFormula({ sheet: sheetId, row, col });
  return typeof formula === "string" ? formula : null;
}

export type StructuralOp =
  | { type: "add-rows"; index: number; count: number }
  | { type: "remove-rows"; index: number; count: number }
  | { type: "add-columns"; index: number; count: number }
  | { type: "remove-columns"; index: number; count: number }
  | { type: "set-row-order"; permutation: number[] };

/**
 * Apply a structural op via HyperFormula and merge the resulting formula
 * changes back into a *document* that already had the same structural change
 * applied to its plain data (rows/cells moved). Only cells that are formulas in
 * the engine overwrite the corresponding document cell.
 *
 * Returns the merged document, or throws if the engine rejects the operation
 * (e.g. an unsupported array-range change), so the caller can cancel the whole
 * command.
 */
export function mergeFormulaReferences(
  structuralDocument: SpreadsheetDocument,
  engineDocument: SpreadsheetDocument,
  op: StructuralOp,
): SpreadsheetDocument {
  const engine = buildEngine(engineDocument);
  const sheetId = engine.getSheetId("Sheet1")!;
  try {
    switch (op.type) {
      case "add-rows":
        engine.addRows(sheetId, [op.index, op.count]);
        break;
      case "remove-rows":
        engine.removeRows(sheetId, [op.index, op.count]);
        break;
      case "add-columns":
        engine.addColumns(sheetId, [op.index, op.count]);
        break;
      case "remove-columns":
        engine.removeColumns(sheetId, [op.index, op.count]);
        break;
      case "set-row-order": {
        // Our permutation is source-at-position: perm[newPos] = oldRow.
        // HyperFormula expects newRowOrder[oldRow] = newPos, so invert it.
        const newRowOrder = new Array<number>(op.permutation.length);
        op.permutation.forEach((oldRow, newPos) => {
          newRowOrder[oldRow] = newPos;
        });
        engine.setRowOrder(sheetId, newRowOrder);
        break;
      }
    }
    const next = cloneDocument(structuralDocument);
    const dimensions = engine.getSheetDimensions(sheetId);
    for (let row = 0; row < dimensions.height; row++) {
      const documentRow = next.rows[row];
      if (!documentRow) continue;
      for (let col = 0; col < dimensions.width; col++) {
        const formula = engineFormula(engine, sheetId, row, col);
        if (formula !== null && formula !== documentRow.cells[col]) {
          documentRow.cells[col] = formula;
          documentRow.fieldCount = Math.max(documentRow.fieldCount, col + 1);
        }
      }
    }
    return next;
  } finally {
    engine.destroy();
  }
}
