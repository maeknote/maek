import { describe, expect, it } from 'vitest'
import { timelineHorizontalWheelDelta } from '../client/src/features/database/utils/timelineScroll'

const viewport = { clientHeight: 400, scrollHeight: 400 }

describe('timelineHorizontalWheelDelta', () => {
  it('moves a non-vertically-scrollable timeline with a standard mouse wheel', () => {
    expect(
      timelineHorizontalWheelDelta({ ...viewport, deltaX: 0, deltaY: 120, deltaMode: 0, shiftKey: false })
    ).toBe(120)
  })

  it('keeps vertical-wheel scrolling for a timeline with vertical overflow', () => {
    expect(
      timelineHorizontalWheelDelta({
        ...viewport,
        scrollHeight: 800,
        deltaX: 0,
        deltaY: 120,
        deltaMode: 0,
        shiftKey: false
      })
    ).toBe(0)
  })

  it('maps Shift plus a line-mode mouse wheel to horizontal pixels', () => {
    expect(
      timelineHorizontalWheelDelta({
        ...viewport,
        scrollHeight: 800,
        deltaX: 0,
        deltaY: 3,
        deltaMode: 1,
        shiftKey: true
      })
    ).toBe(48)
  })

  it('leaves native horizontal trackpad deltas to the browser', () => {
    expect(
      timelineHorizontalWheelDelta({ ...viewport, deltaX: 40, deltaY: 0, deltaMode: 0, shiftKey: false })
    ).toBe(0)
  })
})
