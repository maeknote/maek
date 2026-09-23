export interface TimelineWheelInput {
  deltaX: number
  deltaY: number
  deltaMode: number
  shiftKey: boolean
  clientHeight: number
  scrollHeight: number
}

function wheelDeltaPixels(delta: number, deltaMode: number, pageHeight: number): number {
  switch (deltaMode) {
    // WheelEvent constants are not available in Vitest's Node environment.
    case 1: // DOM_DELTA_LINE
      return delta * 16
    case 2: // DOM_DELTA_PAGE
      return delta * pageHeight
    default:
      return delta
  }
}

/**
 * Returns the vertical-wheel amount that should move a timeline horizontally.
 * Native horizontal trackpad deltas are left to the browser. A mouse wheel
 * moves the time axis when Shift is held, or when the timeline has no vertical
 * overflow to consume the gesture.
 */
export function timelineHorizontalWheelDelta({
  deltaX,
  deltaY,
  deltaMode,
  shiftKey,
  clientHeight,
  scrollHeight
}: TimelineWheelInput): number {
  if (deltaX !== 0 || deltaY === 0) return 0
  if (!shiftKey && scrollHeight > clientHeight) return 0
  return wheelDeltaPixels(deltaY, deltaMode, clientHeight)
}
