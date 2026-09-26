import { describe, expect, it } from "vitest";
import { displayCell } from "../client/src/features/spreadsheet/display";
import { CalcEngine } from "../client/src/features/spreadsheet/calc-engine";
import { parseCsv } from "../client/src/features/spreadsheet/csv-codec";

describe("display rules", () => {
  it("shows plain strings verbatim and preserves leading zeros without right-align", () => {
    const cell = displayCell("00123", "");
    expect(cell.text).toBe("00123");
    expect(cell.isFormula).toBe(false);
    expect(cell.numeric).toBe(false);
  });

  it("right-aligns pure numbers", () => {
    expect(displayCell("42", "").numeric).toBe(true);
    expect(displayCell("-3.5", "").numeric).toBe(true);
  });

  it("does not coerce date/phone-like strings", () => {
    expect(displayCell("2024-01-01", "").numeric).toBe(false);
    expect(displayCell("010-1234-5678", "").numeric).toBe(false);
  });

  it("shows only formula results for = cells and flags errors", () => {
    const ok = displayCell("=SUM(A1:A2)", "7");
    expect(ok.isFormula).toBe(true);
    expect(ok.text).toBe("7");
    expect(ok.numeric).toBe(true);
    const err = displayCell("=1/0", "#DIV/0!");
    expect(err.isError).toBe(true);
    expect(err.numeric).toBe(false);
  });
});

describe("calc engine (synchronous fallback)", () => {
  it("calculates formulas and tags the revision", async () => {
    const engine = new CalcEngine("test-session");
    const document = parseCsv("2,3,=SUM(A1:B1)").document;
    const result = await engine.calculate(document, 5);
    expect(result.revision).toBe(5);
    expect(result.values[0]?.[2]).toBe("5");
    engine.dispose();
  });

  it("tracks the newest delivered revision so stale responses are ignored", () => {
    const engine = new CalcEngine("test-session");
    expect(engine.isNewer(1)).toBe(true);
    engine.markDelivered(3);
    expect(engine.isNewer(2)).toBe(false); // stale
    expect(engine.isNewer(3)).toBe(false); // already delivered
    expect(engine.isNewer(4)).toBe(true);
    engine.dispose();
  });
});
