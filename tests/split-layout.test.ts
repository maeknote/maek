import { describe, expect, it } from "vitest";
import {
  clampSplitRatio,
  ratioFromClientX,
  paneWidths,
  SPLIT_MIN_RATIO,
  SPLIT_MAX_RATIO,
  SPLIT_SEPARATOR_WIDTH,
} from "../client/src/features/editor/utils/splitLayout";

describe("clampSplitRatio", () => {
  it("keeps values inside the 25%–75% range", () => {
    expect(clampSplitRatio(0.5)).toBe(0.5);
    expect(clampSplitRatio(0.3)).toBeCloseTo(0.3);
  });
  it("clamps below the minimum", () => {
    expect(clampSplitRatio(0.1)).toBe(SPLIT_MIN_RATIO);
    expect(clampSplitRatio(-5)).toBe(SPLIT_MIN_RATIO);
  });
  it("clamps above the maximum", () => {
    expect(clampSplitRatio(0.99)).toBe(SPLIT_MAX_RATIO);
    expect(clampSplitRatio(5)).toBe(SPLIT_MAX_RATIO);
  });
  it("falls back to 0.5 for non-finite input", () => {
    expect(clampSplitRatio(Number.NaN)).toBe(0.5);
    expect(clampSplitRatio(Number.POSITIVE_INFINITY)).toBe(0.5);
  });
});

describe("ratioFromClientX", () => {
  const rect = { left: 100, width: 400 };
  it("computes the fraction relative to the captured rectangle", () => {
    expect(ratioFromClientX(300, rect)).toBeCloseTo(0.5); // (300-100)/400
    expect(ratioFromClientX(240, rect)).toBeCloseTo(0.35);
  });
  it("clamps a drag past the left edge to the minimum", () => {
    expect(ratioFromClientX(0, rect)).toBe(SPLIT_MIN_RATIO);
  });
  it("clamps a drag past the right edge to the maximum", () => {
    expect(ratioFromClientX(9999, rect)).toBe(SPLIT_MAX_RATIO);
  });
  it("returns 0.5 for a degenerate zero-width rectangle", () => {
    expect(ratioFromClientX(200, { left: 0, width: 0 })).toBe(0.5);
  });
});

describe("paneWidths", () => {
  it("splits widths around a fixed-width separator", () => {
    const half = SPLIT_SEPARATOR_WIDTH / 2;
    expect(paneWidths(0.5)).toEqual({
      left: `calc(50% - ${half}px)`,
      right: `calc(50% - ${half}px)`,
    });
  });
  it("applies the ratio to the left pane and the complement to the right", () => {
    const half = SPLIT_SEPARATOR_WIDTH / 2;
    expect(paneWidths(0.3)).toEqual({
      left: `calc(30% - ${half}px)`,
      right: `calc(70% - ${half}px)`,
    });
  });
  it("clamps the ratio before computing widths", () => {
    const half = SPLIT_SEPARATOR_WIDTH / 2;
    expect(paneWidths(0.9)).toEqual({
      left: `calc(75% - ${half}px)`,
      right: `calc(25% - ${half}px)`,
    });
  });
});
