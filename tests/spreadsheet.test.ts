import { describe, expect, it } from "vitest";
import { parseTsv, rangeToTsv } from "../client/src/features/spreadsheet/clipboard";
import { deleteColumn, insertColumn, pasteMatrix, sortRows } from "../client/src/features/spreadsheet/commands";
import { parseCsv, serializeCsv } from "../client/src/features/spreadsheet/csv-codec";

describe("CSV codec", () => {
  it("preserves BOM, delimiter, CRLF, embedded newlines, and ragged rows", () => {
    const source = '\uFEFFid;note;tail\r\n001;"hello\r\nworld";\r\n2;short';
    const parsed = parseCsv(source);
    expect(parsed.readonlyReason).toBeNull();
    expect(parsed.document.dialect).toEqual({ bom: true, delimiter: ";", newline: "\r\n" });
    expect(parsed.document.rows[1]?.cells[1]).toBe("hello\r\nworld");
    expect(parsed.document.rows[2]?.fieldCount).toBe(2);
    expect(serializeCsv(parsed.document)).toBe(source);
  });

  it("keeps leading zeroes, formula-like strings, blank rows, and final newline", () => {
    const source = '00123,"=SUM(A1:A3)"\n\n';
    const parsed = parseCsv(source);
    expect(parsed.document.rows[0]?.cells).toEqual(["00123", "=SUM(A1:A3)"]);
    expect(serializeCsv(parsed.document)).toBe("00123,=SUM(A1:A3)\n\n");
  });

  it("opens malformed quoted CSV read-only", () => {
    expect(parseCsv('a,"unterminated').readonlyReason).toMatch(/could not be parsed safely/i);
  });
});

describe("spreadsheet commands", () => {
  it("pastes a rectangular matrix and expands the document", () => {
    const document = parseCsv("a").document;
    const next = pasteMatrix(document, { rowIdx: 1, colIdx: 1 }, [["b", "c"], ["d", "e"]]);
    expect(next.rows).toHaveLength(3);
    expect(next.columnCount).toBe(3);
    expect(next.rows[2]?.cells).toEqual(["", "d", "e"]);
    expect(document.rows).toHaveLength(1);
  });

  it("inserts and deletes columns without mutating the source", () => {
    const document = parseCsv("a,b\n1,2").document;
    const inserted = insertColumn(document, 1);
    expect(inserted.rows[0]?.cells).toEqual(["a", "", "b"]);
    expect(deleteColumn(inserted, 1).rows.map((row) => row.cells)).toEqual(document.rows.map((row) => row.cells));
    expect(document.columnCount).toBe(2);
  });

  it("sorts data stably while retaining a header row", () => {
    const document = parseCsv("name,value\nb,2\na,1\na,3").document;
    const sorted = sortRows(document, 0, "ASC", true);
    expect(sorted.rows.map((row) => row.cells[1])).toEqual(["value", "1", "3", "2"]);
  });
});

describe("TSV clipboard", () => {
  it("round-trips tabs, quotes and embedded newlines", () => {
    const document = parseCsv('"a\tb","line\nvalue"\n"quote ""x""",z').document;
    const range = { anchor: { rowIdx: 0, colIdx: 0 }, focus: { rowIdx: 1, colIdx: 1 } };
    expect(parseTsv(rangeToTsv(document, range))).toEqual(document.rows.map((row) => row.cells));
  });
});
