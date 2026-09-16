// Pure layout helper for the Calendar view.
//
// Splits each event into per-week segments (clamped to week boundaries) and
// assigns lanes greedily so that overlapping segments stack vertically.
// Returned data drives an absolute-positioned overlay on top of the day-cell
// grid, so a single multi-day event renders as one bar per week.

import { differenceInCalendarDays } from 'date-fns'
import type { DatabaseRow } from '@shared/database'

export interface CalendarRowDates {
  row: DatabaseRow
  start: Date
  end: Date
}

export interface WeekEventSegment {
  row: DatabaseRow
  startDayIdx: number
  endDayIdx: number
  isStart: boolean
  isEnd: boolean
  lane: number
}

export interface CalendarWeekLayout {
  days: Date[]
  segments: WeekEventSegment[]
  lanesUsed: number
}

export function layoutCalendarWeeks(
  weeks: Date[][],
  events: CalendarRowDates[]
): CalendarWeekLayout[] {
  return weeks.map((days) => buildWeekLayout(days, events))
}

function buildWeekLayout(days: Date[], events: CalendarRowDates[]): CalendarWeekLayout {
  if (days.length === 0) return { days, segments: [], lanesUsed: 0 }

  const weekStart = days[0]!
  const weekEnd = days[days.length - 1]!
  const lastIdx = days.length - 1

  const candidates: WeekEventSegment[] = []

  for (const event of events) {
    if (event.end < weekStart || event.start > weekEnd) continue

    const startDelta = differenceInCalendarDays(event.start, weekStart)
    const endDelta = differenceInCalendarDays(event.end, weekStart)
    const startDayIdx = Math.max(0, startDelta)
    const endDayIdx = Math.min(lastIdx, endDelta)

    candidates.push({
      row: event.row,
      startDayIdx,
      endDayIdx,
      isStart: startDelta >= 0,
      isEnd: endDelta <= lastIdx,
      lane: -1
    })
  }

  // Multi-day segments first, then by start day. Longer events claim lanes
  // first so single-day events fill in around them.
  candidates.sort((a, b) => {
    const aLen = a.endDayIdx - a.startDayIdx
    const bLen = b.endDayIdx - b.startDayIdx
    if (aLen !== bLen) return bLen - aLen
    return a.startDayIdx - b.startDayIdx
  })

  const laneEnds: number[] = []
  for (const seg of candidates) {
    let assigned = -1
    for (let lane = 0; lane < laneEnds.length; lane++) {
      if (laneEnds[lane]! < seg.startDayIdx) {
        assigned = lane
        break
      }
    }
    if (assigned === -1) {
      assigned = laneEnds.length
      laneEnds.push(seg.endDayIdx)
    } else {
      laneEnds[assigned] = seg.endDayIdx
    }
    seg.lane = assigned
  }

  return { days, segments: candidates, lanesUsed: laneEnds.length }
}
