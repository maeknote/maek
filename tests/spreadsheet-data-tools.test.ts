import { describe, expect, it } from "vitest";
import { computeFillValues } from "../client/src/features/spreadsheet/fill";
import { findMatches, replaceLiteral } from "../client/src/features/spreadsheet/search";
import { sortTargetRows, buildRowPermutation, applyRowPermutation } from "../client/src/features/spreadsheet/sorting";
import { trimCellsIn, removeBlankRowsIn, removeDuplicateRowsIn } from "../client/src/features/spreadsheet/cleanup";
import { parseCsv, serializeCsv } from "../client/src/features/spreadsheet/csv-codec";

describe("fill series", () => {
  it("repeats a single value", () => {
    expect(computeFillValues({ seeds: ["x"], count: 3 })).toEqual(["x", "x", "x"]);
  });

  it("extends a consistent numeric step", () => {
    expect(computeFillValues({ seeds: ["1", "3"], count: 3 })).toEqual(["5", "7", "9"]);
  });

  it("extends a YYYY-MM-DD date step", () => {
    expect(computeFillValues({ seeds: ["2024-01-01", "2024-01-02"], count: 2 })).toEqual(["2024-01-03", "2024-01-04"]);
  });

  it("repeats an ambiguous string pattern", () => {
    expect(computeFillValues({ seeds: ["a", "b"], count: 4 })).toEqual(["a", "b", "a", "b"]);
  });

  it("adjusts formula references by the destination offset", () => {
    const result = computeFillValues({
      seeds: ["=A1"],
      count: 2,
      offsetFor: (index) => ({ row: index + 1, column: 0 }),
    });
    expect(result).toEqual(["=A2", "=A3"]);
  });
});

describe("find and replace", () => {
  const document = parseCsv("name,note\nAlice,hi\nBob,bye\n=A2,x").document;
  const raw = (r: number, c: number) => document.rows[r]?.cells[c] ?? "";

  it("finds display-value matches case-insensitively", () => {
    const matches = findMatches({
      document,
      search: { query: "b", caseSensitive: false, formulaText: false },
      visibleRows: null,
      getDisplayValue: raw,
    });
    // "Bob" and "bye" both contain b/B.
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("finds formula text only in formula-text mode", () => {
    const matches = findMatches({
      document,
      search: { query: "=A2", caseSensitive: true, formulaText: true },
      visibleRows: null,
      getDisplayValue: raw,
    });
    expect(matches).toEqual([{ rowIdx: 3, colIdx: 0 }]);
  });

  it("treats $& and $1 in the replacement as literal characters", () => {
    expect(replaceLiteral("hello", "l", "$&", false)).toBe("he$&$&o");
    expect(replaceLiteral("abcabc", "abc", "[$1]", false)).toBe("[$1][$1]");
  });

  it("respects case sensitivity in replace", () => {
    expect(replaceLiteral("aAaA", "a", "x", true)).toBe("xAxA");
    expect(replaceLiteral("aAaA", "a", "x", false)).toBe("xxxx");
  });
});

describe("sorting", () => {
  it("sorts target rows numerically with empties and errors last", () => {
    const values: Record<string, string> = { "1:0": "3", "2:0": "", "3:0": "1", "4:0": "#REF!", "5:0": "2" };
    const sorted = sortTargetRows({
      targetRows: [1, 2, 3, 4, 5],
      conditions: [{ column: 0, direction: "ASC" }],
      getSortValue: (r, c) => values[`${r}:${c}`] ?? "",
    });
    // 1(row3), 2(row5), 3(row1), then error(row4), empty(row2) last.
    expect(sorted).toEqual([3, 5, 1, 4, 2]);
  });

  it("keeps non-target rows in place via the permutation", () => {
    const document = parseCsv("h\nb\na\nc").document; // rows 0..3
    // Sort data rows 1..3 by their raw value ascending: a(2), b(1), c(3).
    const targetRows = [1, 2, 3];
    const sortedTargetRows = sortTargetRows({
      targetRows,
      conditions: [{ column: 0, direction: "ASC" }],
      getSortValue: (r, c) => document.rows[r]?.cells[c] ?? "",
    });
    expect(sortedTargetRows).toEqual([2, 1, 3]);
    const permutation = buildRowPermutation({ document, targetRows, sortedTargetRows });
    const next = applyRowPermutation(document, permutation);
    expect(next.rows.map((row) => row.cells[0])).toEqual(["h", "a", "b", "c"]);
  });
});

describe("cleanup", () => {
  const document = parseCsv("name,note\n a , x \nb,=SUM(A1)\n,\nb,y").document;

  it("trims plain strings but not formulas, with a preview count", () => {
    const { next, preview } = trimCellsIn(document, [1, 2, 3, 4]);
    expect(preview.affected).toBe(2); // " a " and " x "
    expect(next.rows[1]?.cells).toEqual(["a", "x"]);
    expect(next.rows[2]?.cells[1]).toBe("=SUM(A1)");
  });

  it("removes blank rows in the target set", () => {
    const { next, preview } = removeBlankRowsIn(document, [1, 2, 3, 4], true);
    expect(preview.affected).toBe(1);
    expect(next.rows).toHaveLength(4);
  });

  it("removes duplicate rows by key column keeping the first", () => {
    const { next, preview } = removeDuplicateRowsIn({ document, targetRows: [1, 2, 3, 4], keyColumns: [0], headerMode: true });
    expect(preview.affected).toBe(1); // second "b"
    expect(serializeCsv(next)).toContain("name,note");
  });
});
