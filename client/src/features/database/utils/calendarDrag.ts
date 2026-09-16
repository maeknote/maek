// Pure helper for Calendar drag-to-day.
//
// Given a destination day key (YYYY-MM-DD), returns the new YAML value:
//  - 'date' columns: returns the destination string, or null if unchanged.
//  - 'date-range' columns: returns { start, end } where start = destination
//    and end = destination + originalDuration. Returns null if start unchanged.

import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns'
import { coerceDateString, parseDateRange } from './cellFormat'

export type CalendarDropValue = string | { start: string; end: string }

const ISO_DAY = 'yyyy-MM-dd'

export function computeCalendarDropValue(
  columnType: 'date' | 'date-range',
  currentValue: unknown,
  destinationDayKey: string
): CalendarDropValue | null {
  if (columnType === 'date') {
    const current = coerceDateString(currentValue)
    if (current === destinationDayKey) return null
    return destinationDayKey
  }

  // date-range — preserve duration; if no current range, fall back to a single-day range.
  const range = parseDateRange(currentValue)
  if (!range.start) {
    return { start: destinationDayKey, end: destinationDayKey }
  }
  if (range.start === destinationDayKey) return null

  const startDate = parseISO(range.start)
  const endDate = range.end ? parseISO(range.end) : startDate
  const durationDays = Math.max(0, differenceInCalendarDays(endDate, startDate))

  const nextStart = parseISO(destinationDayKey)
  const nextEnd = format(addDays(nextStart, durationDays), ISO_DAY)
  return { start: destinationDayKey, end: nextEnd }
}
