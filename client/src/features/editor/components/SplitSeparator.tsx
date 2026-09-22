import { useRef, type ReactElement } from "react";
import { useStore, schedulePersistence } from "@renderer/features/workspace";
import {
  ratioFromClientX,
  clampSplitRatio,
  SPLIT_KEYBOARD_STEP,
  SPLIT_MIN_RATIO,
  SPLIT_MAX_RATIO,
  SPLIT_SEPARATOR_WIDTH,
} from "../utils/splitLayout";

interface SplitSeparatorProps {
  /** Returns the file-view area rectangle used to translate clientX → ratio. */
  getAreaRect: () => DOMRect | null;
}

/**
 * Draggable divider between the two split panes.
 *
 * On pointer down it captures the file-view area's bounding rectangle once and
 * derives the ratio from `clientX` relative to that captured rectangle, so the
 * drag stays correct even if layout shifts mid-drag. Pointer capture plus a
 * `pointercancel` cleanup guarantee that dragging outside the window can never
 * leave the separator stuck. ArrowLeft/ArrowRight nudge the ratio by 2%.
 */
export function SplitSeparator({ getAreaRect }: SplitSeparatorProps): ReactElement {
  const ratio = useStore((s) => s.split.ratio);
  const setSplitRatio = useStore((s) => s.setSplitRatio);
  // Rectangle captured at pointer-down so mid-drag layout changes don't skew it.
  const capturedRect = useRef<DOMRect | null>(null);

  const endDrag = (element: HTMLElement, pointerId: number) => {
    capturedRect.current = null;
    if (element.hasPointerCapture(pointerId))
      element.releasePointerCapture(pointerId);
    schedulePersistence();
  };

  return (
    <div
      role="separator"
      aria-label="Resize panes"
      aria-orientation="vertical"
      aria-valuemin={Math.round(SPLIT_MIN_RATIO * 100)}
      aria-valuemax={Math.round(SPLIT_MAX_RATIO * 100)}
      aria-valuenow={Math.round(clampSplitRatio(ratio) * 100)}
      tabIndex={0}
      className="shrink-0 cursor-col-resize border-l border-default touch-none"
      style={{ width: SPLIT_SEPARATOR_WIDTH }}
      onPointerDown={(e) => {
        capturedRect.current = getAreaRect();
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const rect = capturedRect.current;
        if (!rect) return;
        setSplitRatio(ratioFromClientX(e.clientX, rect));
      }}
      onPointerUp={(e) => endDrag(e.currentTarget, e.pointerId)}
      onPointerCancel={(e) => endDrag(e.currentTarget, e.pointerId)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          setSplitRatio(
            ratio + (e.key === "ArrowLeft" ? -SPLIT_KEYBOARD_STEP : SPLIT_KEYBOARD_STEP),
          );
          schedulePersistence();
        }
      }}
    />
  );
}
