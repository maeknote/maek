import { describe, expect, it } from "vitest";
import {
  removeCellFromRanges,
  resolveSelectionCells,
  resolveSelectionRows,
  selectionContains,
  singleSelection,
  isSingleRectangle,
  type SelectionModel,
  type SelectionRange,
} from "../client/src/features/spreadsheet/selection";
import {
  computeVisibleRows,
  distinctColumnValues,
  columnDisplayName,
  isFiltered,
} from "../client/src/features/spreadsheet/filtering";
import { parseCsv } from "../client/src/features/spreadsheet/csv-codec";

function rect(top: number, left: number, bottom: number, right: number): SelectionRange {
  return { anchor: { rowIdx: top, colIdx: left }, focus: { rowIdx: bottom, colIdx: right }, kind: "cell" };
}

describe("multi-range selection", () => {
  it("de-duplicates overlapping ranges when resolving cells", () => {
    const model: SelectionModel = {
      activeCell: { rowIdx: 0, colIdx: 0 },
      anchor: { rowIdx: 0, colIdx: 0 },
      ranges: [rect(0, 0, 1, 1), rect(1, 1, 2, 2)],
    };
    const cells = resolveSelectionCells(model, [0, 1, 2], 3);
    // (1,1) is shared but counted once → 4 + 4 - 1 = 7.
    expect(cells).toHaveLength(7);
  });

  it("restricts resolved cells to visible rows under a filter", () => {
    const model: SelectionModel = {
      activeCell: { rowIdx: 0, colIdx: 0 },
      anchor: { rowIdx: 0, colIdx: 0 },
      ranges: [rect(0, 0, 4, 0)],
    };
    // Rows 1 and 3 hidden by filter.
    const cells = resolveSelectionCells(model, [0, 2, 4], 1);
    expect(cells.map((c) => c.rowIdx)).toEqual([0, 2, 4]);
  });

  it("resolves selection rows in visible order", () => {
    const model: SelectionModel = {
      activeCell: { rowIdx: 4, colIdx: 0 },
      anchor: { rowIdx: 0, colIdx: 0 },
      ranges: [rect(0, 0, 4, 2)],
    };
    expect(resolveSelectionRows(model, [0, 2, 4])).toEqual([0, 2, 4]);
  });

  it("splits a range into surrounding bands when a cell is removed", () => {
    const ranges = removeCellFromRanges([rect(0, 0, 2, 2)], { rowIdx: 1, colIdx: 1 });
    // Center cell removed → the other 8 cells stay covered.
    const model: SelectionModel = { activeCell: { rowIdx: 0, colIdx: 0 }, anchor: { rowIdx: 0, colIdx: 0 }, ranges };
    expect(selectionContains(model, 1, 1)).toBe(false);
    const remaining = resolveSelectionCells(model, [0, 1, 2], 3);
    expect(remaining).toHaveLength(8);
  });

  it("reports single-rectangle selections", () => {
    expect(isSingleRectangle(singleSelection({ rowIdx: 0, colIdx: 0 }))).toBe(true);
    const multi: SelectionModel = {
      activeCell: { rowIdx: 0, colIdx: 0 },
      anchor: { rowIdx: 0, colIdx: 0 },
      ranges: [rect(0, 0, 0, 0), rect(2, 2, 2, 2)],
    };
    expect(isSingleRectangle(multi)).toBe(false);
  });
});

describe("column filters", () => {
  const document = parseCsv("name,score\na,10\nb,20\nc,\nd,20").document;
  const raw = (rowIdx: number, colIdx: number) => document.rows[rowIdx]?.cells[colIdx] ?? "";

  it("keeps the header row and applies value OR within a column", () => {
    const visible = computeVisibleRows({
      document,
      headerMode: true,
      filters: { 1: { values: ["10", "20"] } },
      getDisplayValue: raw,
    });
    // Header (0) + rows with score 10 or 20 (1,2,4). Row 3 (empty) excluded.
    expect(visible).toEqual([0, 1, 2, 4]);
  });

  it("applies AND across columns", () => {
    const visible = computeVisibleRows({
      document,
      headerMode: true,
      filters: { 0: { contains: "b" }, 1: { numeric: { op: ">=", value: 15 } } },
      getDisplayValue: raw,
    });
    expect(visible).toEqual([0, 2]);
  });

  it("filters empty and non-empty", () => {
    expect(
      computeVisibleRows({ document, headerMode: true, filters: { 1: { empty: true } }, getDisplayValue: raw }),
    ).toEqual([0, 3]);
    expect(
      computeVisibleRows({ document, headerMode: true, filters: { 1: { nonEmpty: true } }, getDisplayValue: raw }),
    ).toEqual([0, 1, 2, 4]);
  });

  it("lists distinct column values excluding the header", () => {
    expect(distinctColumnValues({ document, column: 1, headerMode: true, getDisplayValue: raw })).toEqual(["10", "20", ""]);
  });

  it("uses the header value as the column name, falling back to the letter", () => {
    expect(columnDisplayName(document, 0, true)).toBe("name");
    expect(columnDisplayName(document, 5, true)).toBe("F");
    expect(columnDisplayName(document, 0, false)).toBe("A");
  });

  it("detects active filters", () => {
    expect(isFiltered({})).toBe(false);
    expect(isFiltered({ 0: {} })).toBe(false);
    expect(isFiltered({ 0: { contains: "x" } })).toBe(true);
  });
});
