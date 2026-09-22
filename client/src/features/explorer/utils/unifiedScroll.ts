// Pure helpers for the unified Explorer scroll: one shared vertical scroller
// combines the Open Tabs list and the virtualized Files tree. react-arborist
// stays virtualized because the shared scrollTop is translated into the tree's
// own local scroll offset. These helpers are kept free of React and the DOM so
// they can be unit-tested directly.

/** Row height (px) used by the virtualized tree; mirrors ROW_HEIGHT in Explorer. */
export const TREE_ROW_HEIGHT = 28;
/** Fixed height (px) of each sticky section header (Open Tabs / Files). */
export const SECTION_HEADER_HEIGHT = 32;

/** A minimal tree-node shape: a node is a folder iff it exposes `children`. */
export interface CountableNode {
  id: string;
  children?: readonly CountableNode[] | null;
}

/**
 * Count how many rows the tree renders given the currently expanded folders.
 * A folder contributes its own row plus, when expanded, the visible rows of
 * its children (recursively). Collapsed folders contribute only their own row.
 *
 * `expandedFolderIds` is any membership-testable set (Set or array-like with
 * `.has`); passing an empty set yields one row per root subtree head.
 */
export function countVisibleRows(
  nodes: readonly CountableNode[] | null | undefined,
  expandedFolderIds: { has(id: string): boolean },
): number {
  if (!nodes || nodes.length === 0) return 0;
  let count = 0;
  for (const node of nodes) {
    count += 1;
    const children = node.children;
    const isFolder = Array.isArray(children);
    if (isFolder && expandedFolderIds.has(node.id) && children!.length > 0) {
      count += countVisibleRows(children, expandedFolderIds);
    }
  }
  return count;
}

/** Total logical pixel height of the tree for the given visible-row count. */
export function treeContentHeight(
  visibleRowCount: number,
  rowHeight = TREE_ROW_HEIGHT,
): number {
  return Math.max(0, visibleRowCount) * rowHeight;
}

/**
 * Visible viewport height for the tree: the smaller of the full logical
 * content height and the space left in the shared scroller below the sticky
 * Files header. Never negative.
 */
export function treeViewportHeight(
  contentHeight: number,
  sidebarViewportHeight: number,
  headerHeight = SECTION_HEADER_HEIGHT,
): number {
  const available = Math.max(0, sidebarViewportHeight - headerHeight);
  return Math.max(0, Math.min(contentHeight, available));
}

/** The largest tree-local offset that keeps the last row in view. */
export function maxTreeOffset(
  contentHeight: number,
  viewportHeight: number,
): number {
  return Math.max(0, contentHeight - viewportHeight);
}

/**
 * Translate the shared scroller's scrollTop into the tree's local offset.
 * While the scroller is still inside Open Tabs (scrollTop < filesSectionTop)
 * the offset clamps to 0; once inside Files it tracks the overshoot, clamped
 * to the tree's valid range.
 */
export function treeOffsetForScroll(
  sidebarScrollTop: number,
  filesSectionTop: number,
  contentHeight: number,
  viewportHeight: number,
): number {
  const raw = sidebarScrollTop - filesSectionTop;
  return clamp(raw, 0, maxTreeOffset(contentHeight, viewportHeight));
}

/**
 * Inverse of treeOffsetForScroll: the shared scroll position that places the
 * given tree-local offset at the top of the Files viewport.
 */
export function scrollForTreeOffset(
  treeOffset: number,
  filesSectionTop: number,
  contentHeight: number,
  viewportHeight: number,
): number {
  const bounded = clamp(treeOffset, 0, maxTreeOffset(contentHeight, viewportHeight));
  return filesSectionTop + bounded;
}

/**
 * When the number of tabs changes, Files begins at a new vertical position.
 * If the user was already browsing Files, shift the shared scroll by the same
 * delta so the tree row under the viewport top stays put. If the user was still
 * inside Open Tabs, keep the scroll position unchanged.
 */
export function anchorCorrectedScrollTop(
  previousScrollTop: number,
  previousFilesSectionTop: number,
  nextFilesSectionTop: number,
): number {
  const wasBrowsingFiles = previousScrollTop >= previousFilesSectionTop;
  if (!wasBrowsingFiles) return previousScrollTop;
  const delta = nextFilesSectionTop - previousFilesSectionTop;
  return Math.max(0, previousScrollTop + delta);
}

/** True when the shared scroll position sits within the Files section. */
export function isBrowsingFiles(
  sidebarScrollTop: number,
  filesSectionTop: number,
): boolean {
  return sidebarScrollTop >= filesSectionTop;
}

/**
 * Clamp a (possibly stale/restored) shared scroll position to the valid range
 * for the current layout. The maximum scroll leaves the last content pixel at
 * the bottom of the viewport.
 */
export function clampSidebarScroll(
  scrollTop: number,
  scrollContentHeight: number,
  scrollViewportHeight: number,
): number {
  const max = Math.max(0, scrollContentHeight - scrollViewportHeight);
  return clamp(scrollTop, 0, max);
}

/** Standard numeric clamp. */
export function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Two tree offsets are "the same" for feedback-loop suppression when within a
 * 1px tolerance. Parent-driven scrollToOffset calls can land a fraction off.
 */
export function offsetsMatch(a: number, b: number, tolerance = 1): boolean {
  return Math.abs(a - b) <= tolerance;
}

/**
 * Convert a WheelEvent delta to pixels before forwarding it to the shared
 * Explorer scroller. Trackpads normally report pixels, while traditional
 * mouse wheels may report lines or pages.
 */
export function wheelDeltaPixels(
  deltaY: number,
  deltaMode: number,
  pageHeight: number,
  lineHeight = TREE_ROW_HEIGHT,
): number {
  if (deltaMode === 1) return deltaY * lineHeight;
  if (deltaMode === 2) return deltaY * Math.max(0, pageHeight);
  return deltaY;
}
