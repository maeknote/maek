import { forwardRef, useCallback, useEffect, useRef } from "react";
import { ListOuterElement } from "react-arborist";
import { wheelDeltaPixels } from "../utils/unifiedScroll";

/**
 * Custom `outerElementType` for react-arborist's virtual list.
 *
 * In the unified Explorer scroll, the single user-facing scrollbar is the
 * sidebar's `.explorer-content-scroll`. The tree's own scroll offset is driven
 * programmatically via `TreeApi.scrollToOffset`, and keyboard navigation moves
 * it through react-window.
 *
 * react-window scrolls by writing `scrollTop` on this outer element, and
 * react-arborist reads the current offset back from the same `scrollTop`
 * (`TreeApi.scrollOffset`). If we set `overflow-y: hidden`, the browser clamps
 * `scrollTop` to 0, which would (a) break keyboard navigation and (b) make
 * `scrollOffset` always read 0. So the element MUST stay vertically scrollable.
 *
 * To still present a single scrollbar and one continuous scroll gesture:
 *   - The vertical scrollbar is hidden visually (`scrollbar-width: none` and the
 *     WebKit pseudo-element) while `overflow-y: auto` keeps programmatic and
 *     keyboard scrolling working.
 *   - Wheel gestures over the tree are forwarded to the shared scroller (the
 *     nearest ancestor with `data-testid="explorer-content-scroll"`), so the
 *     user never scrolls the tree in isolation.
 *   - `overflow-x: auto` is preserved for deeply indented paths.
 *
 * This wraps the package's exported `ListOuterElement` (rather than replacing
 * it) so the drop cursor (`DropContainer`) and empty-area click-to-deselect stay
 * intact. The package source, patches, and installed dependency are unmodified.
 */
export const UnifiedTreeOuter = forwardRef<
  HTMLDivElement,
  React.HTMLProps<HTMLDivElement>
>(function UnifiedTreeOuter({ style, className, onWheel, ...rest }, ref) {
  const outerRef = useRef<HTMLDivElement | null>(null);

  // react-window needs this element through its forwarded ref, while we also
  // need the concrete node to install a non-passive wheel listener.
  const setOuterRef = useCallback(
    (node: HTMLDivElement | null) => {
      outerRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  const mergedStyle: React.CSSProperties = {
    ...(style as React.CSSProperties),
    overflowY: "auto",
    overflowX: "auto",
    // Hide the tree's own scrollbar; the shared container owns the visible one.
    scrollbarWidth: "none",
  };

  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;

    const handleWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || event.deltaY === 0) return;
      const shared = outer.closest<HTMLElement>(
        '[data-testid="explorer-content-scroll"]',
      );
      if (!shared) return;

      // React registers wheel handlers as passive, so preventDefault() from a
      // React onWheel callback cannot stop this scrollable element's native
      // default action. Own the gesture with a non-passive native listener:
      // only the shared scroller moves, and its normal sync then updates the
      // virtual tree exactly once.
      event.preventDefault();
      shared.scrollTop += wheelDeltaPixels(
        event.deltaY,
        event.deltaMode,
        shared.clientHeight,
      );
    };

    outer.addEventListener("wheel", handleWheel, { passive: false });
    return () => outer.removeEventListener("wheel", handleWheel);
  }, []);

  return (
    <ListOuterElement
      ref={setOuterRef}
      className={["unified-tree-outer", className].filter(Boolean).join(" ")}
      style={mergedStyle}
      onWheel={onWheel}
      {...rest}
    />
  );
});
