import { describe, expect, it } from "vitest";
import {
  EDGE_SCROLL_MAX_SPEED,
  EDGE_SCROLL_MIN_SPEED,
  EDGE_SCROLL_ZONE,
  edgeScrollDelta,
  isSelfOrDescendantDrop,
} from "../client/src/features/explorer/utils/treeDnd";

const rect = { top: 100, bottom: 500 };

describe("edgeScrollDelta", () => {
  it("does not scroll in the calm middle band", () => {
    expect(edgeScrollDelta(300, rect)).toBe(0);
  });

  it("scrolls up inside the top 40px zone and down inside the bottom zone", () => {
    expect(edgeScrollDelta(rect.top + 10, rect)).toBeLessThan(0);
    expect(edgeScrollDelta(rect.bottom - 10, rect)).toBeGreaterThan(0);
  });

  it("ramps from the slow floor at the zone edge to the fast ceiling at the border", () => {
    // Just inside the zone (39px from the top edge) is the slowest speed.
    const slow = edgeScrollDelta(rect.top + (EDGE_SCROLL_ZONE - 1), rect);
    expect(Math.abs(slow)).toBe(EDGE_SCROLL_MIN_SPEED);
    // Right at the top border is the fastest speed.
    const fast = edgeScrollDelta(rect.top, rect);
    expect(Math.abs(fast)).toBe(EDGE_SCROLL_MAX_SPEED);
    // Speed increases monotonically toward the border.
    expect(Math.abs(fast)).toBeGreaterThan(Math.abs(slow));
  });

  it("clamps speed within the configured min/max bounds", () => {
    for (let y = rect.top; y <= rect.bottom; y += 5) {
      const speed = Math.abs(edgeScrollDelta(y, rect));
      if (speed === 0) continue;
      expect(speed).toBeGreaterThanOrEqual(EDGE_SCROLL_MIN_SPEED);
      expect(speed).toBeLessThanOrEqual(EDGE_SCROLL_MAX_SPEED);
    }
  });

  it("stops immediately once the pointer leaves the container bounds", () => {
    expect(edgeScrollDelta(rect.top - 1, rect)).toBe(0);
    expect(edgeScrollDelta(rect.bottom + 1, rect)).toBe(0);
  });
});

describe("isSelfOrDescendantDrop", () => {
  it("treats the root (null parent) as always valid", () => {
    expect(isSelfOrDescendantDrop(null, ["Folder"])).toBe(false);
  });

  it("rejects dropping a folder into itself", () => {
    expect(isSelfOrDescendantDrop("Folder", ["Folder"])).toBe(true);
  });

  it("rejects dropping a folder into its own descendant", () => {
    expect(isSelfOrDescendantDrop("Folder/Nested", ["Folder"])).toBe(true);
    expect(isSelfOrDescendantDrop("Folder/Nested/Deep", ["Folder"])).toBe(true);
  });

  it("allows dropping into an unrelated folder", () => {
    expect(isSelfOrDescendantDrop("Other", ["Folder"])).toBe(false);
    // A sibling that merely shares a name prefix is not a descendant.
    expect(isSelfOrDescendantDrop("Folder2", ["Folder"])).toBe(false);
  });

  it("checks every dragged id when multiple items move at once", () => {
    expect(isSelfOrDescendantDrop("B/inner", ["A", "B"])).toBe(true);
    expect(isSelfOrDescendantDrop("C", ["A", "B"])).toBe(false);
  });
});
