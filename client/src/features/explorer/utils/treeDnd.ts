// Pure helpers for the folder-tree drag-and-drop behaviour. Kept free of React
// and DOM globals so they can be unit-tested directly.

/** Height in px of the top/bottom hot zones that trigger edge auto-scroll. */
export const EDGE_SCROLL_ZONE = 40;
/** Slowest and fastest auto-scroll speeds, in px per animation frame. */
export const EDGE_SCROLL_MIN_SPEED = 4;
export const EDGE_SCROLL_MAX_SPEED = 16;

/**
 * Given the pointer's Y position and the scroll container's rectangle, return
 * the per-frame scroll delta in pixels. Negative scrolls up, positive scrolls
 * down, zero means the pointer is outside both hot zones. Speed ramps linearly
 * with how deep the pointer sits inside the 40px edge band.
 */
export function edgeScrollDelta(
  pointerY: number,
  rect: { top: number; bottom: number },
  zone = EDGE_SCROLL_ZONE,
  minSpeed = EDGE_SCROLL_MIN_SPEED,
  maxSpeed = EDGE_SCROLL_MAX_SPEED,
): number {
  const speedFor = (depth: number) => {
    const ratio = Math.min(1, Math.max(0, depth / zone));
    return Math.round(minSpeed + (maxSpeed - minSpeed) * ratio);
  };
  if (pointerY < rect.top || pointerY > rect.bottom) return 0;
  const distanceFromTop = pointerY - rect.top;
  const distanceFromBottom = rect.bottom - pointerY;
  if (distanceFromTop < zone) return -speedFor(zone - distanceFromTop);
  if (distanceFromBottom < zone) return speedFor(zone - distanceFromBottom);
  return 0;
}

/**
 * A drop into `parentId` is invalid when the parent is one of the dragged
 * nodes or a descendant of one (moving a folder into itself/its own subtree).
 * `parentId` of null/root means the Files root, which is always a valid target.
 */
export function isSelfOrDescendantDrop(
  parentId: string | null,
  dragIds: readonly string[],
): boolean {
  if (!parentId) return false;
  return dragIds.some((id) => parentId === id || parentId.startsWith(id + "/"));
}
