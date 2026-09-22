import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TreeApi } from "react-arborist";
import type { FileNode } from "@shared/workspace";
import {
  SECTION_HEADER_HEIGHT,
  anchorCorrectedScrollTop,
  clampSidebarScroll,
  countVisibleRows,
  isBrowsingFiles,
  offsetsMatch,
  scrollForTreeOffset,
  treeContentHeight as computeTreeContentHeight,
  treeOffsetForScroll,
  treeViewportHeight as computeTreeViewportHeight,
} from "../utils/unifiedScroll";

/**
 * Runtime-only (never persisted) per-workspace scroll memory. Keyed by the
 * workspace root path. Cleared naturally on a full page reload because it lives
 * in module scope.
 */
const sidebarScrollMemory = new Map<string, number>();

interface UseUnifiedExplorerScrollArgs {
  /** react-arborist tree handle. */
  tree: React.RefObject<TreeApi<FileNode> | null>;
  /** Root file nodes (same tree the <Tree> renders). */
  data: FileNode[];
  /** Currently expanded folder ids. */
  expanded: string[];
  /** Current workspace root path, used as the scroll-memory key. */
  workspaceRoot: string | null;
  /** Number of currently rendered (non-popup) tabs; drives layout shifts. */
  tabCount: number;
  /**
   * Combined height (px) of the pinned, stacked section headers above the tree
   * viewport. Both the tree viewport height and the shared→tree offset math
   * account for this so the first tree row lines up beneath the headers.
   */
  headerStackHeight: number;
}

interface UseUnifiedExplorerScrollResult {
  /** The single user-scrollable container. */
  sidebarScrollRef: React.RefObject<HTMLDivElement | null>;
  /** Wrapper around the Files section (header + spacer). */
  filesSectionRef: React.RefObject<HTMLDivElement | null>;
  /** The sticky, real-size tree viewport inside the logical spacer. */
  filesViewportRef: React.RefObject<HTMLDivElement | null>;
  /** Pixel height passed to <Tree height=...>. */
  treeViewportHeight: number;
  /** Logical spacer height = full virtual tree height. */
  treeContentHeight: number;
  /** onScroll handler for the shared scroller. */
  onSidebarScroll: () => void;
  /** onScroll handler bound to the tree's outer element. */
  onTreeScroll: () => void;
  /** Reveal a node by centring it and syncing the shared scroller. */
  scrollTreeNodeIntoView: (id: string) => Promise<boolean>;
  /** Distance (px) from the top of the shared scroller to the Files section. */
  measureFilesSectionTop: () => number;
  /** Scroll the shared container to an absolute position, clamped. */
  scrollSidebarTo: (scrollTop: number) => void;
}

/**
 * Coordinates the shared Explorer scroller with react-arborist's internal
 * virtual scroll. Keeps all DOM measurement and scroll math out of the render
 * body so Explorer.tsx stays declarative.
 */
export function useUnifiedExplorerScroll({
  tree,
  data,
  expanded,
  workspaceRoot,
  tabCount,
  headerStackHeight,
}: UseUnifiedExplorerScrollArgs): UseUnifiedExplorerScrollResult {
  const sidebarScrollRef = useRef<HTMLDivElement>(null);
  const filesSectionRef = useRef<HTMLDivElement>(null);
  const filesViewportRef = useRef<HTMLDivElement>(null);

  // Measured height of the shared scroller viewport.
  const [sidebarViewportHeight, setSidebarViewportHeight] = useState(0);

  // Visible-row count -> logical tree height. Recomputed only when the tree
  // data or the expanded set changes.
  const expandedSet = useMemo(() => new Set(expanded), [expanded]);
  const visibleRowCount = useMemo(
    () => countVisibleRows(data, expandedSet),
    [data, expandedSet],
  );
  const treeContentHeight = useMemo(
    () => computeTreeContentHeight(visibleRowCount),
    [visibleRowCount],
  );
  const treeViewportHeight = useMemo(
    () =>
      computeTreeViewportHeight(
        treeContentHeight,
        sidebarViewportHeight,
        headerStackHeight,
      ),
    [treeContentHeight, sidebarViewportHeight, headerStackHeight],
  );

  // --- feedback-loop guards --------------------------------------------------
  // The tree-local offset we last pushed via scrollToOffset. When onTreeScroll
  // reports this value (within 1px), it is our own parent-driven event and must
  // be ignored so we don't bounce the shared scroller back.
  const expectedTreeOffset = useRef<number | null>(null);
  // Ensure at most one sync per animation frame.
  const rafPending = useRef<number | null>(null);
  // Prevent onSidebarScroll from firing while we programmatically set scrollTop.
  const programmaticScroll = useRef(false);

  // The shared-scroll position at which the tree's first row aligns with the
  // top of the (sticky) tree viewport, i.e. treeOffset === 0. filesSectionRef
  // marks the non-sticky logical tree spacer; the pinned headers above the
  // viewport are subtracted so the offset math stays anchored to the tree.
  const measureFilesSectionTop = useCallback((): number => {
    const scroller = sidebarScrollRef.current;
    const section = filesSectionRef.current;
    if (!scroller || !section) return 0;
    const scrollerRect = scroller.getBoundingClientRect();
    const sectionRect = section.getBoundingClientRect();
    const flowTop = sectionRect.top - scrollerRect.top + scroller.scrollTop;
    return Math.max(0, flowTop - headerStackHeight);
  }, [headerStackHeight]);

  // Observe the shared scroller height so virtualization tracks the real
  // viewport rather than the total node count.
  useEffect(() => {
    const el = sidebarScrollRef.current;
    if (!el) return;
    const measure = () => setSidebarViewportHeight(el.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [workspaceRoot]);

  /** Push the shared scrollTop into the tree's local offset. */
  const syncTreeToSidebar = useCallback(
    (scrollTop: number) => {
      const api = tree.current;
      if (!api) return;
      const filesTop = measureFilesSectionTop();
      const offset = treeOffsetForScroll(
        scrollTop,
        filesTop,
        treeContentHeight,
        treeViewportHeight,
      );
      expectedTreeOffset.current = offset;
      api.scrollToOffset(offset);
    },
    [tree, measureFilesSectionTop, treeContentHeight, treeViewportHeight],
  );

  const scrollSidebarTo = useCallback(
    (scrollTop: number) => {
      const el = sidebarScrollRef.current;
      if (!el) return;
      const clamped = clampSidebarScroll(
        scrollTop,
        el.scrollHeight,
        el.clientHeight,
      );
      programmaticScroll.current = true;
      el.scrollTop = clamped;
      // The scroll event fires asynchronously; still translate to the tree now
      // so the two stay coherent even before the event lands.
      syncTreeToSidebar(clamped);
      // Release the guard on the next frame after the scroll event settles.
      requestAnimationFrame(() => {
        programmaticScroll.current = false;
      });
    },
    [syncTreeToSidebar],
  );

  // --- shared scroller -> tree ----------------------------------------------
  const onSidebarScroll = useCallback(() => {
    if (programmaticScroll.current) return;
    const el = sidebarScrollRef.current;
    if (!el) return;
    // Remember position for runtime restore.
    if (workspaceRoot) sidebarScrollMemory.set(workspaceRoot, el.scrollTop);
    if (rafPending.current !== null) return;
    rafPending.current = requestAnimationFrame(() => {
      rafPending.current = null;
      const scroller = sidebarScrollRef.current;
      if (!scroller) return;
      syncTreeToSidebar(scroller.scrollTop);
    });
  }, [workspaceRoot, syncTreeToSidebar]);

  // --- tree -> shared scroller ----------------------------------------------
  // Keyboard navigation / TreeApi.scrollTo changes the tree's own offset; mirror
  // that into the shared scroller. Skip the echo of our own scrollToOffset.
  const onTreeScroll = useCallback(() => {
    const api = tree.current;
    const scroller = sidebarScrollRef.current;
    if (!api || !scroller) return;
    const offset = api.scrollOffset;
    if (
      expectedTreeOffset.current !== null &&
      offsetsMatch(offset, expectedTreeOffset.current)
    ) {
      // This is the echo of a parent-driven scrollToOffset; ignore it.
      return;
    }
    // Genuine tree-originated scroll (keyboard / scrollTo). Move the shared
    // scroller to match, without triggering the reverse sync again.
    const filesTop = measureFilesSectionTop();
    const target = scrollForTreeOffset(
      offset,
      filesTop,
      treeContentHeight,
      treeViewportHeight,
    );
    if (!offsetsMatch(target, scroller.scrollTop)) {
      programmaticScroll.current = true;
      expectedTreeOffset.current = offset;
      scroller.scrollTop = target;
      if (workspaceRoot) sidebarScrollMemory.set(workspaceRoot, target);
      requestAnimationFrame(() => {
        programmaticScroll.current = false;
      });
    }
  }, [tree, measureFilesSectionTop, treeContentHeight, treeViewportHeight, workspaceRoot]);

  // --- reveal ---------------------------------------------------------------
  const scrollTreeNodeIntoView = useCallback(
    async (id: string): Promise<boolean> => {
      const api = tree.current;
      if (!api) return false;
      // 1. Let Arborist open parents and compute the local offset.
      await api.scrollTo(id, "center");
      if (!api.get(id)) return false;
      // 2. Wait one frame so scrollOffset reflects the new layout.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      // 3/4. Translate the tree offset into the shared scroll position.
      const filesTop = measureFilesSectionTop();
      const target = scrollForTreeOffset(
        api.scrollOffset,
        filesTop,
        treeContentHeight,
        treeViewportHeight,
      );
      scrollSidebarTo(target);
      return true;
    },
    [tree, measureFilesSectionTop, treeContentHeight, treeViewportHeight, scrollSidebarTo],
  );

  // --- anchor preservation when tab count changes ---------------------------
  // Record filesSectionTop and scrollTop before the layout changes, then after
  // the DOM updates, shift the shared scroll so the same Files row stays put.
  const prevTabCount = useRef(tabCount);
  const preLayout = useRef<{ scrollTop: number; filesTop: number } | null>(null);
  if (prevTabCount.current !== tabCount) {
    const el = sidebarScrollRef.current;
    if (el) {
      preLayout.current = {
        scrollTop: el.scrollTop,
        filesTop: measureFilesSectionTop(),
      };
    }
    prevTabCount.current = tabCount;
  }
  useLayoutEffect(() => {
    const snapshot = preLayout.current;
    if (!snapshot) return;
    preLayout.current = null;
    const el = sidebarScrollRef.current;
    if (!el) return;
    // Only correct if the user was browsing Files at snapshot time.
    if (!isBrowsingFiles(snapshot.scrollTop, snapshot.filesTop)) return;
    const nextFilesTop = measureFilesSectionTop();
    const corrected = anchorCorrectedScrollTop(
      snapshot.scrollTop,
      snapshot.filesTop,
      nextFilesTop,
    );
    scrollSidebarTo(corrected);
  }, [tabCount, scrollSidebarTo, measureFilesSectionTop]);

  // --- runtime-only per-workspace scroll restore ----------------------------
  // Restore only after the tree height and section positions are measured.
  useEffect(() => {
    if (!workspaceRoot) return;
    const el = sidebarScrollRef.current;
    if (!el) return;
    if (sidebarViewportHeight === 0) return; // not measured yet
    const remembered = sidebarScrollMemory.get(workspaceRoot);
    // A frame lets the tree spacer reach its final height before we clamp.
    const raf = requestAnimationFrame(() => {
      const scroller = sidebarScrollRef.current;
      if (!scroller) return;
      const target = clampSidebarScroll(
        remembered ?? 0,
        scroller.scrollHeight,
        scroller.clientHeight,
      );
      scrollSidebarTo(target);
    });
    return () => cancelAnimationFrame(raf);
    // Re-run when the workspace changes or the first real measurement lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceRoot, sidebarViewportHeight > 0]);

  // Cancel any pending sync frame on unmount.
  useEffect(
    () => () => {
      if (rafPending.current !== null) cancelAnimationFrame(rafPending.current);
    },
    [],
  );

  // The tree's scroll container is react-arborist's outer element (our
  // UnifiedTreeOuter). Its scrollTop changes on keyboard nav / TreeApi.scrollTo
  // and via our own scrollToOffset. Listen natively (scroll doesn't bubble) so
  // genuine tree-originated scrolls mirror back into the shared scroller.
  const onTreeScrollRef = useRef(onTreeScroll);
  onTreeScrollRef.current = onTreeScroll;
  useEffect(() => {
    const viewport = filesViewportRef.current;
    if (!viewport) return;
    let attached: HTMLElement | null = null;
    const handler = () => onTreeScrollRef.current();
    // react-arborist renders: viewport > div[role=tree] > <outerElement> (the
    // scrollable one). Scroll events fire on the outer element and do not
    // bubble, so bind directly to it.
    const findScrollable = (): HTMLElement | null => {
      const treeEl = viewport.querySelector<HTMLElement>('[role="tree"]');
      return (treeEl?.firstElementChild as HTMLElement | null) ?? null;
    };
    const attach = () => {
      const el = findScrollable();
      if (el && el !== attached) {
        if (attached) attached.removeEventListener("scroll", handler);
        el.addEventListener("scroll", handler, { passive: true });
        attached = el;
      }
    };
    attach();
    // The tree's outer element can mount slightly after the viewport, so watch
    // the subtree for it appearing/replacing on data or workspace changes.
    const observer = new MutationObserver(attach);
    observer.observe(viewport, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (attached) attached.removeEventListener("scroll", handler);
    };
  }, [workspaceRoot]);

  return {
    sidebarScrollRef,
    filesSectionRef,
    filesViewportRef,
    treeViewportHeight,
    treeContentHeight,
    onSidebarScroll,
    onTreeScroll,
    scrollTreeNodeIntoView,
    measureFilesSectionTop,
    scrollSidebarTo,
  };
}

export { sidebarScrollMemory, SECTION_HEADER_HEIGHT };
