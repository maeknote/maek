import { describe, expect, it } from "vitest";
import { clearRange, setCell } from "../client/src/features/spreadsheet/commands";
import { parseCsv, serializeCsv } from "../client/src/features/spreadsheet/csv-codec";
import { runTransaction } from "../client/src/features/spreadsheet/transaction";
import { SheetHistory } from "../client/src/features/spreadsheet/history";
import { computeGridShape, buildDisplayRows } from "../client/src/features/spreadsheet/coordinates";
import { CSV_LIMITS } from "../client/src/features/spreadsheet/model";

describe("virtual cell materialization", () => {
  it("materializes rows only when a non-empty value is written", () => {
    const document = parseCsv("a").document;
    const next = setCell(document, { rowIdx: 3, colIdx: 2 }, "z");
    expect(next).not.toBe(document);
    expect(next.rows).toHaveLength(4);
    expect(next.rows[3]?.cells[2]).toBe("z");
    expect(next.rows[3]?.fieldCount).toBe(3);
    expect(next.columnCount).toBe(3);
    // Original untouched.
    expect(document.rows).toHaveLength(1);
  });

  it("writing an empty value into a virtual cell is a no-op", () => {
    const document = parseCsv("a").document;
    expect(setCell(document, { rowIdx: 50, colIdx: 10 }, "")).toBe(document);
  });

  it("writing an empty value into an already-empty existing cell is a no-op", () => {
    const document = parseCsv("a,,c").document;
    expect(setCell(document, { rowIdx: 0, colIdx: 1 }, "")).toBe(document);
  });

  it("clearing empty cells never grows fieldCount and returns the same document", () => {
    const document = parseCsv("a,b").document;
    const cleared = clearRange(document, { anchor: { rowIdx: 0, colIdx: 0 }, focus: { rowIdx: 0, colIdx: 9 } });
    // Only the two real cells were cleared; no new fields were added.
    expect(cleared.rows[0]?.fieldCount).toBe(2);
    expect(cleared.rows[0]?.cells.slice(0, 2)).toEqual(["", ""]);
  });

  it("clearing a range with nothing to clear is a no-op", () => {
    const document = parseCsv("a,b").document;
    expect(clearRange(document, { anchor: { rowIdx: 0, colIdx: 5 }, focus: { rowIdx: 0, colIdx: 9 } })).toBe(document);
  });
});

describe("transaction atomicity and limits", () => {
  it("reports no-op transactions without producing a new document", () => {
    const document = parseCsv("a,,c").document;
    const result = runTransaction(document, { type: "set-cell", position: { rowIdx: 0, colIdx: 1 }, value: "" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.noop).toBe(true);
      expect(result.next).toBe(document);
    }
  });

  it("applies a change and returns serialized CSV", () => {
    const document = parseCsv("a").document;
    const result = runTransaction(document, { type: "set-cell", position: { rowIdx: 0, colIdx: 1 }, value: "b" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.noop).toBe(false);
      expect(result.serialized).toBe("a,b");
      expect(serializeCsv(result.next)).toBe("a,b");
    }
  });

  it("fails without mutating the document when a paste exceeds the column limit", () => {
    const document = parseCsv("a").document;
    const wide = [Array.from({ length: CSV_LIMITS.columns + 5 }, (_, i) => `c${i}`)];
    const result = runTransaction(document, { type: "paste", start: { rowIdx: 0, colIdx: 0 }, matrix: wide });
    expect(result.ok).toBe(false);
    expect(document.rows).toHaveLength(1);
  });

  it("fails a cell write past the row limit", () => {
    const document = parseCsv("a").document;
    const result = runTransaction(document, { type: "set-cell", position: { rowIdx: CSV_LIMITS.rows + 1, colIdx: 0 }, value: "x" });
    expect(result.ok).toBe(false);
  });
});

describe("undo/redo history", () => {
  it("steps backward and forward across commands", () => {
    const history = new SheetHistory();
    const a = parseCsv("a").document;
    const b = parseCsv("b").document;
    const c = parseCsv("c").document;
    history.push({ before: a, after: b });
    history.push({ before: b, after: c });
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);

    const undone = history.undo();
    expect(serializeCsv(undone!.before)).toBe("b");
    expect(history.canRedo).toBe(true);

    const redone = history.redo();
    expect(serializeCsv(redone!.after)).toBe("c");
  });

  it("clears the redo stack when a new command is pushed", () => {
    const history = new SheetHistory();
    const a = parseCsv("a").document;
    const b = parseCsv("b").document;
    history.push({ before: a, after: b });
    history.undo();
    expect(history.canRedo).toBe(true);
    history.push({ before: a, after: parseCsv("d").document });
    expect(history.canRedo).toBe(false);
  });
});

describe("grid coordinates", () => {
  it("presents at least the visible floor of rows and columns", () => {
    const document = parseCsv("a,b").document;
    const shape = computeGridShape(document, { maxRows: CSV_LIMITS.rows, maxColumns: CSV_LIMITS.columns });
    expect(shape.rowCount).toBe(100);
    expect(shape.columnCount).toBe(26);
  });

  it("includes document size when larger than the floor", () => {
    const rows = Array.from({ length: 150 }, (_, i) => `${i}`).join("\n");
    const document = parseCsv(rows).document;
    const shape = computeGridShape(document, { maxRows: CSV_LIMITS.rows, maxColumns: CSV_LIMITS.columns });
    expect(shape.rowCount).toBe(150);
  });

  it("appends virtual rows when not filtering but not while filtered", () => {
    const document = parseCsv("a\nb\nc").document;
    const unfiltered = buildDisplayRows({
      document,
      visibleDocumentIndexes: [0, 1, 2],
      gridRowCount: 10,
      headerMode: false,
      filtered: false,
    });
    expect(unfiltered).toHaveLength(10);
    expect(unfiltered[9]?.documentIndex).toBe(9);

    const filtered = buildDisplayRows({
      document,
      visibleDocumentIndexes: [0, 2],
      gridRowCount: 10,
      headerMode: false,
      filtered: true,
    });
    expect(filtered).toHaveLength(2);
    expect(filtered.map((r) => r.documentIndex)).toEqual([0, 2]);
  });
});
