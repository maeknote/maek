import { describe, it, expect } from "vitest";
import { computeCalendarDropValue } from "../client/src/features/database/utils/calendarDrag";
import { computeTimelineDragValue } from "../client/src/features/database/utils/timelineDrag";
import { layoutCalendarWeeks } from "../client/src/features/database/utils/calendarLayout";
import { applyFilter } from "../client/src/features/database/utils/filterEvaluator";
import { applySort } from "../client/src/features/database/utils/rowSort";
import { computeAggregation } from "../client/src/features/database/utils/aggregation";
import { databaseRowFilePath } from "../client/src/features/database/utils/rowFilePath";
import type { DatabaseRow, DatabaseColumnSchema } from "../shared/database";
const row = (id: string, values: Record<string, unknown>): DatabaseRow => ({
  id,
  databaseId: "db",
  fileName: id + ".md",
  path: id + ".md",
  yamlData: values,
  hash: "",
  fileMtime: 1,
  sortOrder: 0,
  createdAt: 1,
  updatedAt: 1,
});
describe("ported desktop view algorithms", () => {
  it("builds database note paths relative to the workspace root", () => {
    expect(databaseRowFilePath("Projects", "Task A.md")).toBe("Projects/Task A.md");
    expect(databaseRowFilePath("", "Task A.md")).toBe("Task A.md");
  });

  it("keeps scalar dates and preserves duration across month and DST boundaries", () => {
    expect(computeCalendarDropValue("date", "2026-01-31", "2026-02-01")).toBe(
      "2026-02-01",
    );
    expect(
      computeCalendarDropValue(
        "date-range",
        { start: "2026-03-07", end: "2026-03-10" },
        "2026-03-31",
      ),
    ).toEqual({ start: "2026-03-31", end: "2026-04-03" });
    expect(
      computeTimelineDragValue({
        columnType: "date",
        currentValue: "2026-09-15",
        mode: "move",
        deltaDays: 2,
      }),
    ).toBe("2026-09-17");
    expect(
      computeTimelineDragValue({
        columnType: "date",
        currentValue: "2026-09-15",
        mode: "resize-end",
        deltaDays: 2,
      }),
    ).toBeNull();
  });
  it("clamps inverted ranges and ignores zero displacement", () => {
    expect(
      computeTimelineDragValue({
        columnType: "date-range",
        currentValue: { start: "2026-09-15", end: "2026-09-18" },
        mode: "resize-start",
        deltaDays: 10,
      }),
    ).toEqual({ start: "2026-09-18", end: "2026-09-18" });
    expect(
      computeTimelineDragValue({
        columnType: "date-range",
        currentValue: { start: "2026-09-15", end: "2026-09-18" },
        mode: "move",
        deltaDays: 0,
      }),
    ).toBeNull();
  });
  it("lays out cross-week events and overlapping lanes", () => {
    const days = Array.from({ length: 7 }, (_, i) => new Date(2026, 8, 13 + i));
    const weeks = layoutCalendarWeeks(
      [days],
      [
        {
          row: row("a", {}),
          start: new Date(2026, 8, 12),
          end: new Date(2026, 8, 16),
        },
        {
          row: row("b", {}),
          start: new Date(2026, 8, 15),
          end: new Date(2026, 8, 19),
        },
      ],
    );
    expect(weeks[0]!.lanesUsed).toBe(2);
    expect(weeks[0]!.segments.find((s) => s.row.id === "a")).toMatchObject({
      startDayIdx: 0,
      endDayIdx: 3,
      isStart: false,
    });
  });
  it("combines typed filters, numeric sorting and aggregates", () => {
    const columns: DatabaseColumnSchema[] = [
      { id: "n", name: "Amount", type: "number", order: 0, aggregation: "sum" },
    ];
    const rows = [
      row("two", { Amount: 2 }),
      row("ten", { Amount: 10 }),
      row("empty", {}),
    ];
    const filtered = applyFilter(rows, columns, {
      combinator: "and",
      conditions: [{ columnId: "n", operator: "num-gte", value: 2 }],
    });
    expect(
      applySort(filtered, columns, [{ columnId: "n", direction: "desc" }]).map(
        (r) => r.id,
      ),
    ).toEqual(["ten", "two"]);
    expect(computeAggregation(filtered, columns[0]!)).toBe("12");
  });
});
