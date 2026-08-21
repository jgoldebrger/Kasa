import { HDate } from '@hebcal/hdate'
import {
  daysInGregorianMonth,
  getYearInTimeZone,
  startOfDayInTimeZone,
  zonedWallClockToUtc,
} from '@/lib/date-utils'

export type CycleStartInput = {
  calendar: 'gregorian' | 'hebrew'
  cycleStartMonth: number
  cycleStartDay: number
  cycleStartHebrewMonth: number
  cycleStartHebrewDay: number
  timezone: string | null | undefined
  now: Date
}

export function currentBillingCycleStart(input: CycleStartInput): Date {
  if (input.calendar === 'hebrew') {
    const today = new HDate(startOfDayInTimeZone(input.timezone, input.now))
    const month = input.cycleStartHebrewMonth
    const day = input.cycleStartHebrewDay
    let year = today.getFullYear()
    let start = new HDate(day, month, year)
    if (today.abs() < start.abs()) {
      start = new HDate(day, month, year - 1)
    }
    return startOfDayInTimeZone(input.timezone, start.greg())
  }

  const yearNow = getYearInTimeZone(input.timezone, input.now)
  const month = input.cycleStartMonth
  const lastDay = daysInGregorianMonth(yearNow, month)
  const day = Math.min(input.cycleStartDay, lastDay)
  const thisYear = zonedWallClockToUtc(yearNow, month, day, 0, 0, 0, 0, input.timezone)
  const nowStart = startOfDayInTimeZone(input.timezone, input.now)
  if (nowStart.getTime() >= thisYear.getTime()) return thisYear
  const prevLast = daysInGregorianMonth(yearNow - 1, month)
  const prevDay = Math.min(input.cycleStartDay, prevLast)
  return zonedWallClockToUtc(yearNow - 1, month, prevDay, 0, 0, 0, 0, input.timezone)
}
