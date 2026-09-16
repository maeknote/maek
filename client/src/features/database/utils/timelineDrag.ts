// Pure date-math helpers for Timeline drag/resize.
//
// Inputs are the raw YAML cell value plus a snapped delta in days; outputs
// are the new YAML value to persist via `useDatabaseView.updateCell`.
// Returns null when the input is invalid or the value would not change.

import { addDays, format, parseISO } from 'date-fns'
import { coerceDateString, parseDateRange } from './cellFormat'

export type TimelineDragMode = 'move' | 'resize-start' | 'resize-end'

export interface TimelineDragInput {
  columnType: 'date' | 'date-range'
  currentValue: unknown
  mode: TimelineDragMode
  deltaDays: number
}

export type TimelineDragValue = string | { start: string; end: string }

const ISO_DAY = 'yyyy-MM-dd'

export function computeTimelineDragValue(input: TimelineDragInput): TimelineDragValue | null {
  const { columnType, currentValue, mode, deltaDays } = input
  if (!Number.isFinite(deltaDays) || deltaDays === 0) return null

  if (columnType === 'date') {
    if (mode !== 'move') return null
    const current = coerceDateString(currentValue)
    if (!current) return null
    const next = format(addDays(parseISO(current), deltaDays), ISO_DAY)
    return next === current ? null : next
  }

  // date-range — mirrors the renderer's behavior of treating a missing `end`
  // as a single-day range (end defaults to start).
  const range = parseDateRange(currentValue)
  if (!range.start) return null
  const start = parseISO(range.start)
  const endIso = range.end ?? range.start
  const end = parseISO(endIso)

  switch (mode) {
    case 'move': {
      const nextStart = format(addDays(start, deltaDays), ISO_DAY)
      const nextEnd = format(addDays(end, deltaDays), ISO_DAY)
      if (nextStart === range.start && nextEnd === endIso) return null
      return { start: nextStart, end: nextEnd }
    }
    case 'resize-start': {
      const candidate = addDays(start, deltaDays)
      // Min 1-day duration: start <= end. Clamp to end if exceeded.
      const clampedStart = candidate.getTime() > end.getTime() ? end : candidate
      const nextStart = format(clampedStart, ISO_DAY)
      if (nextStart === range.start) return null
      return { start: nextStart, end: endIso }
    }
    case 'resize-end': {
      const candidate = addDays(end, deltaDays)
      const clampedEnd = candidate.getTime() < start.getTime() ? start : candidate
      const nextEnd = format(clampedEnd, ISO_DAY)
      if (nextEnd === endIso) return null
      return { start: range.start, end: nextEnd }
    }
  }
}
