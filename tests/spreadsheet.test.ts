import { describe, expect, it } from "vitest";
import { parseTsv, rangeToTsv } from "../client/src/features/spreadsheet/clipboard";
import { deleteColumn, deleteRow, insertColumn, insertRow, pasteMatrix, removeBlankRows, removeDuplicateRows, replaceText, sortRows, sortRowsByColumns, trimCells } from "../client/src/features/spreadsheet/commands";
import { parseCsv, serializeCsv } from "../client/src/features/spreadsheet/csv-codec";
import { calculateCells } from "../client/src/features/spreadsheet/formulas";
import { adjustFormulaReferences } from "../client/src/features/spreadsheet/formula-references";

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

  it("detects the record newline outside quoted cell content", () => {
    const source = 'a,b\r\n1,"one\ntwo"\r\n3,4';
    const parsed = parseCsv(source);
    expect(parsed.document.dialect.newline).toBe("\r\n");
    expect(parsed.document.rows[1]?.cells[1]).toBe("one\ntwo");
    expect(serializeCsv(parsed.document)).toBe(source);
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

  it("updates formula references when rows and columns are inserted or removed", () => {
    const source = parseCsv("=B2,=A1\n1,2").document;
    expect(insertColumn(source, 0).rows[0]?.cells.slice(0, 3)).toEqual(["", "=C2", "=B1"]);
    expect(insertRow(source, 0).rows[1]?.cells[0]).toBe("=B3");
    expect(deleteColumn(source, 1).rows[0]?.cells[0]).toBe("=#REF!");
    expect(deleteRow(source, 1).rows[0]?.cells[0]).toBe("=#REF!");
  });

  it("keeps ragged rows aligned when inserting a column past their last field", () => {
    const document = parseCsv("a,b,c\nx").document;
    const inserted = insertColumn(document, 2);
    expect(inserted.rows.map((row) => row.cells.slice(0, row.fieldCount))).toEqual([
      ["a", "b", "", "c"],
      ["x"],
    ]);
  });

  it("sorts data stably while retaining a header row", () => {
    const document = parseCsv("name,value\nb,2\na,1\na,3").document;
    const sorted = sortRows(document, 0, "ASC", true);
    expect(sorted.rows.map((row) => row.cells[1])).toEqual(["value", "1", "3", "2"]);
  });

  it("sorts on multiple columns and runs safe CSV cleanup operations", () => {
    const document = parseCsv("group,name\nb,z\na,b\na,a\n,,\na,a").document;
    const sorted = sortRowsByColumns(document, [{ column: 0, direction: "ASC" }, { column: 1, direction: "ASC" }], true);
    expect(sorted.rows.map((row) => row.cells[1])).toEqual(["name", "", "a", "a", "b", "z"]);
    expect(removeDuplicateRows(document, true).rows.map((row) => row.cells[1])).toEqual(["name", "z", "b", "a", ""]);
    expect(removeBlankRows(document, true).rows).toHaveLength(5);
    expect(trimCells(parseCsv(" name , value ").document).rows[0]?.cells).toEqual(["name", "value"]);
    expect(replaceText(parseCsv("hello HELLO").document, "hello", "hi").rows[0]?.cells[0]).toBe("hi hi");
  });
});

describe("spreadsheet formulas", () => {
  it("calculates formulas while retaining their original CSV strings", () => {
    const document = parseCsv("2,3,=SUM(A1:B1)\n=C1*2").document;
    expect(calculateCells(document)).toEqual([["2", "3", "5"], ["10", "", ""]]);
    expect(serializeCsv(document)).toBe("2,3,=SUM(A1:B1)\n=C1*2");
  });

  it("adjusts relative references when a copied formula moves", () => {
    expect(adjustFormulaReferences('=SUM(A1:$B2)+C$3+$D$4+"A1"+LOG10(A1)', 2, 1))
      .toBe('=SUM(B3:$B4)+D$3+$D$4+"A1"+LOG10(B3)');
  });
});

describe("TSV clipboard", () => {
  it("round-trips tabs, quotes and embedded newlines", () => {
    const document = parseCsv('"a\tb","line\nvalue"\n"quote ""x""",z').document;
    const range = { anchor: { rowIdx: 0, colIdx: 0 }, focus: { rowIdx: 1, colIdx: 1 } };
    expect(parseTsv(rangeToTsv(document, range))).toEqual(document.rows.map((row) => row.cells));
  });

  it("keeps quote marks that are literal text inside an unquoted TSV cell", () => {
    expect(parseTsv('say "hello"\tx')).toEqual([[ 'say "hello"', "x" ]]);
  });
});
