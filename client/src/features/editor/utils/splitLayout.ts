/** Split-pane layout math. Kept pure and framework-free for unit testing. */

export const SPLIT_MIN_RATIO = 0.25;
export const SPLIT_MAX_RATIO = 0.75;
/** Fixed separator width in pixels. */
export const SPLIT_SEPARATOR_WIDTH = 8;
/** Keyboard resize increment (2%). */
export const SPLIT_KEYBOARD_STEP = 0.02;

/** Clamp a ratio into the allowed 25%–75% range. */
export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5;
  return Math.min(SPLIT_MAX_RATIO, Math.max(SPLIT_MIN_RATIO, ratio));
}

/**
 * Compute a ratio from a pointer's clientX relative to a captured bounding
 * rectangle. The result is clamped into the allowed range.
 */
export function ratioFromClientX(
  clientX: number,
  rect: { left: number; width: number },
): number {
  if (rect.width <= 0) return 0.5;
  return clampSplitRatio((clientX - rect.left) / rect.width);
}

export interface PaneWidths {
  /** CSS width for the left pane. */
  left: string;
  /** CSS width for the right pane. */
  right: string;
}

/**
 * CSS widths for the two panes given a ratio. The separator occupies a fixed
 * pixel width, so each pane is `calc(<fraction> - <half separator>)`.
 */
export function paneWidths(
  ratio: number,
  separatorWidth = SPLIT_SEPARATOR_WIDTH,
): PaneWidths {
  const clamped = clampSplitRatio(ratio);
  const half = separatorWidth / 2;
  return {
    left: `calc(${clamped * 100}% - ${half}px)`,
    right: `calc(${(1 - clamped) * 100}% - ${half}px)`,
  };
}
