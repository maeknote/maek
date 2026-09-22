import { describe, expect, it } from "vitest";
import {
  SECTION_HEADER_HEIGHT,
  TREE_ROW_HEIGHT,
  anchorCorrectedScrollTop,
  clamp,
  clampSidebarScroll,
  countVisibleRows,
  isBrowsingFiles,
  maxTreeOffset,
  offsetsMatch,
  scrollForTreeOffset,
  treeContentHeight,
  treeOffsetForScroll,
  treeViewportHeight,
  wheelDeltaPixels,
  type CountableNode,
} from "../client/src/features/explorer/utils/unifiedScroll";

/** Convenience: build an expanded-id set from a list. */
const expanded = (...ids: string[]) => new Set(ids);

/** A small fixture tree used across the row-counting tests. */
const tree: CountableNode[] = [
  {
    id: "A",
    children: [
      { id: "A/1" },
      {
        id: "A/2",
        children: [{ id: "A/2/a" }, { id: "A/2/b" }],
      },
    ],
  },
  { id: "B" }, // a leaf file at the root
  {
    id: "C",
    children: [{ id: "C/1" }],
  },
];

describe("countVisibleRows", () => {
  it("returns 0 for an empty or nullish tree", () => {
    expect(countVisibleRows([], expanded())).toBe(0);
    expect(countVisibleRows(null, expanded())).toBe(0);
    expect(countVisibleRows(undefined, expanded())).toBe(0);
  });

  it("counts only root heads when nothing is expanded", () => {
    // A (folder), B (file), C (folder) -> 3 rows.
    expect(countVisibleRows(tree, expanded())).toBe(3);
  });

  it("includes only children of expanded folders", () => {
    // Expand A only: A, A/1, A/2 (collapsed), B, C -> 5 rows.
    expect(countVisibleRows(tree, expanded("A"))).toBe(5);
  });

  it("counts deeply nested rows when parents are expanded", () => {
    // Expand A and A/2: A, A/1, A/2, A/2/a, A/2/b, B, C -> 7 rows.
    expect(countVisibleRows(tree, expanded("A", "A/2"))).toBe(7);
  });

  it("does not count grandchildren when the intermediate folder is collapsed", () => {
    // Expanding A/2 without A keeps A collapsed, so its subtree stays hidden.
    expect(countVisibleRows(tree, expanded("A/2"))).toBe(3);
  });

  it("handles multiple expanded roots", () => {
    // Expand A and C: A, A/1, A/2, B, C, C/1 -> 6 rows.
    expect(countVisibleRows(tree, expanded("A", "C"))).toBe(6);
  });

  it("treats an empty children array as a folder with no visible children", () => {
    const emptyFolder: CountableNode[] = [{ id: "E", children: [] }];
    expect(countVisibleRows(emptyFolder, expanded("E"))).toBe(1);
  });
});

describe("treeContentHeight / treeViewportHeight / maxTreeOffset", () => {
  it("multiplies visible rows by the row height", () => {
    expect(treeContentHeight(5)).toBe(5 * TREE_ROW_HEIGHT);
    expect(treeContentHeight(0)).toBe(0);
    expect(treeContentHeight(-3)).toBe(0);
  });

  it("caps the viewport at available space below the header", () => {
    const content = treeContentHeight(100); // large
    // Sidebar 500 tall, header 32 -> 468 available, smaller than content.
    expect(treeViewportHeight(content, 500)).toBe(500 - SECTION_HEADER_HEIGHT);
  });

  it("shrinks the viewport to the content when the tree is short", () => {
    const content = treeContentHeight(3); // 84px
    expect(treeViewportHeight(content, 500)).toBe(content);
  });

  it("never returns a negative viewport", () => {
    expect(treeViewportHeight(0, 10)).toBe(0);
    expect(treeViewportHeight(100, 10)).toBe(0);
  });

  it("computes the max offset as content minus viewport, floored at 0", () => {
    expect(maxTreeOffset(1000, 400)).toBe(600);
    expect(maxTreeOffset(200, 400)).toBe(0);
  });
});

describe("treeOffsetForScroll", () => {
  const content = 1000;
  const viewport = 400;
  const filesTop = 300;

  it("is 0 while the shared scroller is inside Open Tabs", () => {
    expect(treeOffsetForScroll(0, filesTop, content, viewport)).toBe(0);
    expect(treeOffsetForScroll(150, filesTop, content, viewport)).toBe(0);
    expect(treeOffsetForScroll(filesTop, filesTop, content, viewport)).toBe(0);
  });

  it("equals sidebarScrollTop - filesSectionTop inside Files", () => {
    expect(treeOffsetForScroll(filesTop + 120, filesTop, content, viewport)).toBe(120);
    expect(treeOffsetForScroll(filesTop + 500, filesTop, content, viewport)).toBe(500);
  });

  it("clamps at the end of the tree", () => {
    // max offset is 1000 - 400 = 600.
    expect(treeOffsetForScroll(filesTop + 5000, filesTop, content, viewport)).toBe(600);
  });

  it("clamps at the beginning of the tree", () => {
    expect(treeOffsetForScroll(-100, filesTop, content, viewport)).toBe(0);
  });
});

describe("scrollForTreeOffset (inverse of treeOffsetForScroll)", () => {
  const content = 1000;
  const viewport = 400;
  const filesTop = 300;

  it("converts a tree offset back to the correct shared-scroll position", () => {
    expect(scrollForTreeOffset(120, filesTop, content, viewport)).toBe(filesTop + 120);
  });

  it("round-trips within the valid range", () => {
    for (const scroll of [filesTop, filesTop + 100, filesTop + 600]) {
      const offset = treeOffsetForScroll(scroll, filesTop, content, viewport);
      expect(scrollForTreeOffset(offset, filesTop, content, viewport)).toBe(scroll);
    }
  });

  it("clamps offsets beyond the tree range", () => {
    expect(scrollForTreeOffset(9999, filesTop, content, viewport)).toBe(filesTop + 600);
    expect(scrollForTreeOffset(-50, filesTop, content, viewport)).toBe(filesTop);
  });
});

describe("anchorCorrectedScrollTop", () => {
  it("keeps the Files-local position stable when Open Tabs height grows", () => {
    // User is 200px into Files (filesTop was 300, scroll 500). A new tab pushes
    // Files down by 28px -> filesTop 328. Scroll should follow to 528 so the
    // same tree row stays under the viewport top.
    expect(anchorCorrectedScrollTop(500, 300, 328)).toBe(528);
  });

  it("keeps the Files-local position stable when Open Tabs height shrinks", () => {
    expect(anchorCorrectedScrollTop(500, 300, 272)).toBe(472);
  });

  it("does not correct while the user is still browsing Open Tabs", () => {
    // scroll 100 < filesTop 300 -> untouched even though filesTop changed.
    expect(anchorCorrectedScrollTop(100, 300, 328)).toBe(100);
  });

  it("treats sitting exactly at the Files boundary as browsing Files", () => {
    expect(anchorCorrectedScrollTop(300, 300, 328)).toBe(328);
  });

  it("never returns a negative scroll position", () => {
    expect(anchorCorrectedScrollTop(305, 300, 0)).toBe(5);
    expect(anchorCorrectedScrollTop(300, 300, -400)).toBe(0);
  });
});

describe("isBrowsingFiles", () => {
  it("is true at or past the Files section top", () => {
    expect(isBrowsingFiles(300, 300)).toBe(true);
    expect(isBrowsingFiles(400, 300)).toBe(true);
  });
  it("is false while inside Open Tabs", () => {
    expect(isBrowsingFiles(299, 300)).toBe(false);
    expect(isBrowsingFiles(0, 300)).toBe(false);
  });
});

describe("clampSidebarScroll", () => {
  it("clamps restored values to the current valid range", () => {
    // content 1000, viewport 400 -> max scroll 600.
    expect(clampSidebarScroll(9999, 1000, 400)).toBe(600);
    expect(clampSidebarScroll(-10, 1000, 400)).toBe(0);
    expect(clampSidebarScroll(250, 1000, 400)).toBe(250);
  });
  it("returns 0 when content fits entirely in the viewport", () => {
    expect(clampSidebarScroll(120, 300, 400)).toBe(0);
  });
});

describe("clamp / offsetsMatch", () => {
  it("clamps within bounds and handles inverted bounds", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(5, 10, 0)).toBe(10); // max < min -> min
  });

  it("matches offsets within a 1px tolerance", () => {
    expect(offsetsMatch(100, 100)).toBe(true);
    expect(offsetsMatch(100, 100.7)).toBe(true);
    expect(offsetsMatch(100, 102)).toBe(false);
  });
});

describe("wheelDeltaPixels", () => {
  it("keeps pixel-mode trackpad deltas unchanged", () => {
    expect(wheelDeltaPixels(17.5, 0, 600)).toBe(17.5);
  });

  it("converts line-mode mouse-wheel deltas using the tree row height", () => {
    expect(wheelDeltaPixels(3, 1, 600)).toBe(3 * TREE_ROW_HEIGHT);
    expect(wheelDeltaPixels(-2, 1, 600)).toBe(-2 * TREE_ROW_HEIGHT);
  });

  it("converts page-mode deltas using the shared viewport height", () => {
    expect(wheelDeltaPixels(1, 2, 600)).toBe(600);
    expect(wheelDeltaPixels(-1, 2, 600)).toBe(-600);
  });
});
