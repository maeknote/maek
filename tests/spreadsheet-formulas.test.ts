import { describe, expect, it } from "vitest";
import { parseCsv } from "../client/src/features/spreadsheet/csv-codec";
import { calculateCells } from "../client/src/features/spreadsheet/formulas";
import { mergeFormulaReferences } from "../client/src/features/spreadsheet/formula-engine";
import { insertRow, deleteRow, insertColumn } from "../client/src/features/spreadsheet/commands";
import { buildRowPermutation, sortTargetRows, applyRowPermutation } from "../client/src/features/spreadsheet/sorting";

describe("HyperFormula reference transformation", () => {
  it("shrinks a SUM range when a middle row is removed", () => {
    // A4 = SUM(A1:A3); removing row 2 (index 1) should shrink to A1:A2.
    const document = parseCsv("1\n2\n3\n=SUM(A1:A3)").document;
    // Apply structural change to plain data first (delete row index 1).
    const structural = deleteRow(document, 1);
    const merged = mergeFormulaReferences(structural, document, { type: "remove-rows", index: 1, count: 1 });
    const formula = merged.rows[merged.rows.length - 1]?.cells[0];
    expect(formula).toBe("=SUM(A1:A2)");
    // And it still calculates: 1 + 3 = 4.
    expect(calculateCells(merged)[merged.rows.length - 1]?.[0]).toBe("4");
  });

  it("shifts references down when a row is inserted", () => {
    const document = parseCsv("=A2\n5").document; // A1 references A2
    const structural = insertRow(document, 0);
    const merged = mergeFormulaReferences(structural, document, { type: "add-rows", index: 0, count: 1 });
    // The formula moved to row 2 and should now reference A3.
    expect(merged.rows[1]?.cells[0]).toBe("=A3");
  });

  it("shifts column references when a column is inserted", () => {
    const document = parseCsv("=B1,10").document; // A1 references B1
    const structural = insertColumn(document, 0);
    const merged = mergeFormulaReferences(structural, document, { type: "add-columns", index: 0, count: 1 });
    // Formula moved to B1, referencing C1.
    expect(merged.rows[0]?.cells[1]).toBe("=C1");
  });

  it("transforms references when rows are reordered by sort", () => {
    // Rows: header, then data referencing each other.
    const document = parseCsv("v\n=A3\n10\n20").document;
    // Sort data rows 1..3 descending by raw value; row1="=A3", row2="10", row3="20".
    const targetRows = [1, 2, 3];
    const sortedTargetRows = sortTargetRows({
      targetRows,
      conditions: [{ column: 0, direction: "DESC" }],
      getSortValue: (r, c) => calculateCells(document)[r]?.[c] ?? "",
    });
    const permutation = buildRowPermutation({ document, targetRows, sortedTargetRows });
    const structural = applyRowPermutation(document, permutation);
    const merged = mergeFormulaReferences(structural, document, { type: "set-row-order", permutation });
    // Every produced formula should still be a valid formula string.
    const formulaCells = merged.rows.flatMap((row) => row.cells).filter((c) => c.startsWith("="));
    expect(formulaCells.length).toBeGreaterThan(0);
    // Recalculation must not throw.
    expect(() => calculateCells(merged)).not.toThrow();
  });
});
