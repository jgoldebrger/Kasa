import {
  addCalendarDaysToDateKey,
  dateKeyInTimeZone,
  daysInGregorianMonth,
  getWeekdayInTimeZone,
  parseDateKey,
  zonedWallClockToUtc,
} from '@/lib/date-utils'
import type { CalendarItem, CalendarItemKind } from '@/lib/route-logic/calendar'

export { addCalendarDaysToDateKey }

export type { CalendarItem, CalendarItemKind }

export interface CalendarResponse {
  timezone: string
  from: string
  to: string
  items: CalendarItem[]
}

export function calendarApiUrl(from: string, to: string): string {
  const params = new URLSearchParams({ from, to })
  return `/api/calendar?${params.toString()}`
}

export function parseCalendarResponse(data: unknown): CalendarResponse | null {
  if (!data || typeof data !== 'object') return null
  const root = data as Record<string, unknown>
  const payload = (root.data ?? root) as Record<string, unknown>
  if (!Array.isArray(payload.items)) return null
  return {
    timezone: String(payload.timezone ?? 'UTC'),
    from: String(payload.from ?? ''),
    to: String(payload.to ?? ''),
    items: payload.items as CalendarItem[],
  }
}

/** Today's date key in the org timezone. */
export function todayDateKey(timezone: string): string {
  return dateKeyInTimeZone(timezone, new Date())
}

/** Inclusive `from`/`to` keys for a Gregorian month in org timezone. */
export function monthRangeKeys(year: number, month: number): { from: string; to: string } {
  const lastDay = daysInGregorianMonth(year, month)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    from: `${year}-${pad(month)}-01`,
    to: `${year}-${pad(month)}-${pad(lastDay)}`,
  }
}

/** Inclusive week range (Sunday–Saturday) containing `anchorKey`. */
export function weekRangeKeys(anchorKey: string, timezone: string): { from: string; to: string } {
  const parsed = parseDateKey(anchorKey)
  if (!parsed) {
    const today = todayDateKey(timezone)
    return weekRangeKeys(today, timezone)
  }
  const anchorUtc = zonedWallClockToUtc(
    parsed.year,
    parsed.month,
    parsed.day,
    12,
    0,
    0,
    0,
    timezone,
  )
  const weekday = getWeekdayInTimeZone(timezone, anchorUtc)
  const from = addCalendarDaysToDateKey(anchorKey, -weekday, timezone)
  const to = addCalendarDaysToDateKey(from, 6, timezone)
  return { from, to }
}

export interface CalendarGridDay {
  dateKey: string
  day: number
  inMonth: boolean
}

/** Build a 6-row month grid (Sun-first) for the given year/month. */
export function buildMonthGrid(year: number, month: number, timezone: string): CalendarGridDay[] {
  const pad = (n: number) => String(n).padStart(2, '0')
  const firstKey = `${year}-${pad(month)}-01`
  const firstUtc = zonedWallClockToUtc(year, month, 1, 12, 0, 0, 0, timezone)
  const startWeekday = getWeekdayInTimeZone(timezone, firstUtc)
  const daysInMonth = daysInGregorianMonth(year, month)
  const cells: CalendarGridDay[] = []

  for (let i = 0; i < startWeekday; i++) {
    const key = addCalendarDaysToDateKey(firstKey, i - startWeekday, timezone)
    const parsed = parseDateKey(key)
    cells.push({
      dateKey: key,
      day: parsed?.day ?? 0,
      inMonth: false,
    })
  }

  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      dateKey: `${year}-${pad(month)}-${pad(d)}`,
      day: d,
      inMonth: true,
    })
  }

  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1]
    const nextKey = addCalendarDaysToDateKey(last.dateKey, 1, timezone)
    const parsed = parseDateKey(nextKey)
    cells.push({
      dateKey: nextKey,
      day: parsed?.day ?? 0,
      inMonth: false,
    })
  }

  while (cells.length < 42) {
    const last = cells[cells.length - 1]
    const nextKey = addCalendarDaysToDateKey(last.dateKey, 1, timezone)
    const parsed = parseDateKey(nextKey)
    cells.push({
      dateKey: nextKey,
      day: parsed?.day ?? 0,
      inMonth: false,
    })
  }

  return cells
}

/** Seven consecutive days starting at `weekStartKey`. */
export function buildWeekDays(weekStartKey: string, timezone: string): CalendarGridDay[] {
  return Array.from({ length: 7 }, (_, i) => {
    const dateKey = addCalendarDaysToDateKey(weekStartKey, i, timezone)
    const parsed = parseDateKey(dateKey)
    return {
      dateKey,
      day: parsed?.day ?? 0,
      inMonth: true,
    }
  })
}

export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  let m = month + delta
  let y = year
  while (m < 1) {
    m += 12
    y -= 1
  }
  while (m > 12) {
    m -= 12
    y += 1
  }
  return { year: y, month: m }
}

export function itemsByDateKey(items: CalendarItem[]): Map<string, CalendarItem[]> {
  const map = new Map<string, CalendarItem[]>()
  for (const item of items) {
    const list = map.get(item.dateKey) ?? []
    list.push(item)
    map.set(item.dateKey, list)
  }
  return map
}
