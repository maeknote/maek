import { HyperFormula } from "hyperformula";
import type { SpreadsheetDocument } from "./model";

/** Evaluate formula strings kept in the CSV cells without replacing their source text. */
export function calculateCells(document: SpreadsheetDocument): string[][] {
  const data = document.rows.map((row) =>
    Array.from({ length: document.columnCount }, (_, column) => row.cells[column] ?? ""),
  );
  const engine = HyperFormula.buildFromArray(data, { licenseKey: "gpl-v3" });
  try {
    return engine.getSheetValues(engine.getSheetId("Sheet1")!).map((row) =>
      Array.from({ length: document.columnCount }, (_, column) => {
        const value = row[column];
        if (value === null || value === undefined) return "";
        if (typeof value === "object" && "value" in value) return String(value.value ?? "");
        return String(value);
      }),
    );
  } finally {
    engine.destroy();
  }
}
