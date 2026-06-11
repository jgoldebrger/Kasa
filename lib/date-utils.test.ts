import { describe, expect, it, vi } from 'vitest'
import {
  addMonthsClamped,
  calendarDayBoundsInTimeZone,
  calendarMonthBoundsInTimeZone,
  calendarYearBoundsInTimeZone,
  endOfMonth,
  formatLocaleDate,
  getDayInTimeZone,
  getMonthInTimeZone,
  getYearInTimeZone,
  hebrewMonthBounds,
  isFiniteDate,
  monthEndDedupRange,
  previousHebrewYearMonth,
  previousMonthStart,
  previousStatementPeriodBounds,
  previousYearMonth,
  previousYearMonthInTimeZone,
  startOfDayInTimeZone,
  tolerantMsRange,
  zonedWallClockToUtc,
} from './date-utils'

describe('calendarMonthBoundsInTimeZone', () => {
  it('ends on the last day of the requested month (not the next month)', () => {
    const { fromDate, toDate } = calendarMonthBoundsInTimeZone(2024, 2, 'UTC')
    expect(fromDate.toISOString()).toBe('2024-02-01T00:00:00.000Z')
    expect(toDate.toISOString()).toBe('2024-02-29T23:59:59.999Z')
  })
})

describe('calendarYearBoundsInTimeZone', () => {
  it('anchors Jan 1 midnight in America/New_York to the correct UTC instant', () => {
    const { start, endExclusive } = calendarYearBoundsInTimeZone(2024, 'America/New_York')
    // 2024-01-01 00:00:00 EST = 2024-01-01T05:00:00.000Z
    expect(start.toISOString()).toBe('2024-01-01T05:00:00.000Z')
    // 2025-01-01 00:00:00 EST = 2025-01-01T05:00:00.000Z
    expect(endExclusive.toISOString()).toBe('2025-01-01T05:00:00.000Z')
  })
})

describe('previousStatementPeriodBounds', () => {
  it('uses Gregorian month windows when calendar is unset', () => {
    const ref = new Date('2026-03-15T12:00:00.000Z')
    const period = previousStatementPeriodBounds('gregorian', 'America/New_York', ref)
    expect(period.year).toBe(2026)
    expect(period.month).toBe(2) // February 2026
    expect(period.fromDate.getTime()).toBeLessThan(period.toDate.getTime())
  })

  it('uses Hebrew month windows when calendar is hebrew', () => {
    const ref = new Date('2026-03-15T12:00:00.000Z')
    const period = previousStatementPeriodBounds('hebrew', 'America/New_York', ref)
    const expected = previousHebrewYearMonth(ref)
    expect(period.year).toBe(expected.year)
    expect(period.month).toBe(expected.month)
    const bounds = hebrewMonthBounds(expected.year, expected.month)
    expect(period.fromDate.getTime()).toBe(bounds.fromDate.getTime())
    expect(period.toDate.getTime()).toBe(bounds.toDate.getTime())
  })
})

describe('tolerantMsRange', () => {
  it('widens a Date by ±999ms', () => {
    const d = new Date('2026-01-31T23:59:59.999Z')
    const range = tolerantMsRange(d) as { $gte: Date; $lte: Date }
    expect(range.$gte.getTime()).toBe(d.getTime() - 999)
    expect(range.$lte.getTime()).toBe(d.getTime() + 999)
  })
})

describe('addMonthsClamped', () => {
  it('clamps Jan 31 to the last day of February instead of overflowing', () => {
    const input = new Date(2024, 0, 31, 12, 0, 0, 0)
    const result = addMonthsClamped(input, 1)
    expect(result.getFullYear()).toBe(2024)
    expect(result.getMonth()).toBe(1)
    expect(result.getDate()).toBe(29)
  })
})

describe('isFiniteDate', () => {
  it('returns false for nullish and invalid strings', () => {
    expect(isFiniteDate(null)).toBe(false)
    expect(isFiniteDate(undefined)).toBe(false)
    expect(isFiniteDate('not-a-date')).toBe(false)
  })

  it('returns true for valid Date instances and ISO strings', () => {
    expect(isFiniteDate(new Date('2024-01-01'))).toBe(true)
    expect(isFiniteDate('2024-01-01T00:00:00.000Z')).toBe(true)
  })
})

describe('formatLocaleDate', () => {
  it('returns em dash for invalid dates', () => {
    expect(formatLocaleDate(null)).toBe('—')
    expect(formatLocaleDate('invalid')).toBe('—')
  })

  it('formats valid dates with locale options', () => {
    const formatted = formatLocaleDate(new Date('2024-06-15T12:00:00.000Z'), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    })
    expect(formatted).toMatch(/Jun/)
    expect(formatted).toMatch(/15/)
    expect(formatted).toMatch(/2024/)
  })
})

describe('previousMonthStart', () => {
  it('returns midnight on the first day of the previous month', () => {
    const ref = new Date(2024, 5, 15)
    const start = previousMonthStart(ref)
    expect(start.getFullYear()).toBe(2024)
    expect(start.getMonth()).toBe(4)
    expect(start.getDate()).toBe(1)
    expect(start.getHours()).toBe(0)
  })
})

describe('endOfMonth', () => {
  it('returns 23:59:59.999 on the last day of the reference month', () => {
    const ref = new Date(2024, 1, 10)
    const end = endOfMonth(ref)
    expect(end.getMonth()).toBe(1)
    expect(end.getDate()).toBe(29)
    expect(end.getHours()).toBe(23)
    expect(end.getMinutes()).toBe(59)
    expect(end.getSeconds()).toBe(59)
    expect(end.getMilliseconds()).toBe(999)
  })
})

describe('monthEndDedupRange', () => {
  it('spans the last second of the month from ms=0 through ms=999', () => {
    const ref = new Date(2024, 2, 10)
    const range = monthEndDedupRange(ref)
    expect(range.$gte.getTime()).toBe(new Date(2024, 2, 31, 23, 59, 59, 0).getTime())
    expect(range.$lte.getTime()).toBe(new Date(2024, 2, 31, 23, 59, 59, 999).getTime())
  })
})

describe('previousYearMonth', () => {
  it('returns the calendar year and 1-based month for the previous month', () => {
    expect(previousYearMonth(new Date(2024, 0, 15))).toEqual({ year: 2023, month: 12 })
    expect(previousYearMonth(new Date(2024, 5, 1))).toEqual({ year: 2024, month: 5 })
  })
})

describe('previousYearMonthInTimeZone', () => {
  it('derives the previous month in the org timezone', () => {
    const ref = new Date('2026-03-15T12:00:00.000Z')
    expect(previousYearMonthInTimeZone('America/New_York', ref)).toEqual({ year: 2026, month: 2 })
  })

  it('falls back to server-local previousYearMonth when timezone is invalid', () => {
    const ref = new Date(2024, 5, 15)
    expect(previousYearMonthInTimeZone('Not/A/Timezone', ref)).toEqual(previousYearMonth(ref))
  })

  it('treats blank timezone as UTC', () => {
    const ref = new Date('2026-01-01T12:00:00.000Z')
    expect(previousYearMonthInTimeZone('  ', ref)).toEqual({ year: 2025, month: 12 })
  })
})

describe('getYearInTimeZone / getMonthInTimeZone / getDayInTimeZone', () => {
  const ref = new Date('2024-06-15T12:00:00.000Z')

  it('reads wall-clock parts in the requested timezone', () => {
    expect(getYearInTimeZone('America/New_York', ref)).toBe(2024)
    expect(getMonthInTimeZone('America/New_York', ref)).toBe(6)
    expect(getDayInTimeZone('America/New_York', ref)).toBe(15)
  })

  it('falls back to server-local parts when timezone is invalid', () => {
    expect(getYearInTimeZone('Bad/Zone', ref)).toBe(ref.getFullYear())
    expect(getMonthInTimeZone('Bad/Zone', ref)).toBe(ref.getMonth() + 1)
    expect(getDayInTimeZone('Bad/Zone', ref)).toBe(ref.getDate())
  })
})

describe('zonedWallClockToUtc', () => {
  it('builds UTC instants directly when zone is UTC', () => {
    const d = zonedWallClockToUtc(2024, 1, 1, 0, 0, 0, 0, 'UTC')
    expect(d.toISOString()).toBe('2024-01-01T00:00:00.000Z')
  })

  it('converts wall-clock instants in America/New_York to UTC', () => {
    const d = zonedWallClockToUtc(2024, 1, 1, 0, 0, 0, 0, 'America/New_York')
    expect(d.toISOString()).toBe('2024-01-01T05:00:00.000Z')
  })

  it('falls back to local Date construction when timezone is invalid', () => {
    const d = zonedWallClockToUtc(2024, 6, 15, 10, 30, 0, 0, 'Invalid/TZ')
    expect(d.getFullYear()).toBe(2024)
    expect(d.getMonth()).toBe(5)
    expect(d.getDate()).toBe(15)
    expect(d.getHours()).toBe(10)
  })
})

describe('calendarDayBoundsInTimeZone', () => {
  it('returns a half-open UTC range for one calendar day in the zone', () => {
    const ref = new Date('2024-06-15T12:00:00.000Z')
    const { from, toExclusive } = calendarDayBoundsInTimeZone('UTC', ref)
    expect(from.toISOString()).toBe('2024-06-15T00:00:00.000Z')
    expect(toExclusive.toISOString()).toBe('2024-06-16T00:00:00.000Z')
  })
})

describe('hebrewMonthBounds', () => {
  it('uses local Gregorian midnight when no timezone is provided', () => {
    const { fromDate, toDate } = hebrewMonthBounds(5784, 7)
    expect(fromDate.getHours()).toBe(0)
    expect(toDate.getHours()).toBe(23)
    expect(toDate.getTime()).toBeGreaterThan(fromDate.getTime())
  })
})

describe('previousHebrewYearMonth', () => {
  it('steps back one Hebrew month from the reference date', () => {
    const ref = new Date('2026-03-15T12:00:00.000Z')
    const prev = previousHebrewYearMonth(ref)
    expect(prev.year).toBeGreaterThan(0)
    expect(prev.month).toBeGreaterThanOrEqual(1)
    expect(prev.month).toBeLessThanOrEqual(13)
  })
})

describe('previousStatementPeriodBounds', () => {
  it('honors explicit year/month override for Gregorian calendars', () => {
    const period = previousStatementPeriodBounds('gregorian', 'UTC', new Date(), {
      year: 2020,
      month: 3,
    })
    expect(period.year).toBe(2020)
    expect(period.month).toBe(3)
    expect(period.fromDate.toISOString()).toBe('2020-03-01T00:00:00.000Z')
  })
})

describe('startOfDayInTimeZone', () => {
  it('returns midnight on the org wall clock as a UTC instant', () => {
    const ref = new Date('2024-06-15T18:00:00.000Z')
    const start = startOfDayInTimeZone('America/New_York', ref)
    expect(start.toISOString()).toBe('2024-06-15T04:00:00.000Z')
  })

  it('falls back to server-local midnight when timezone is invalid', () => {
    const ref = new Date(2024, 5, 15, 14, 30, 0, 0)
    const start = startOfDayInTimeZone('Not/A/Zone', ref)
    expect(start.getHours()).toBe(0)
    expect(start.getMinutes()).toBe(0)
    expect(start.getDate()).toBe(15)
  })

  it('falls back when Intl returns non-numeric date parts', () => {
    const ref = new Date(2024, 5, 15, 14, 30, 0, 0)
    const partsSpy = vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts').mockReturnValue([
      { type: 'year', value: 'not-a-number' },
      { type: 'month', value: '06' },
      { type: 'day', value: '15' },
    ] as Intl.DateTimeFormatPart[])

    const start = startOfDayInTimeZone('America/New_York', ref)
    expect(start.getHours()).toBe(0)
    expect(start.getMinutes()).toBe(0)
    expect(start.getDate()).toBe(15)

    partsSpy.mockRestore()
  })
})

describe('calendarMonthBoundsInTimeZone', () => {
  it('uses UTC when timezone is omitted', () => {
    const { fromDate, toDate } = calendarMonthBoundsInTimeZone(2024, 1, null)
    expect(fromDate.toISOString()).toBe('2024-01-01T00:00:00.000Z')
    expect(toDate.toISOString()).toBe('2024-01-31T23:59:59.999Z')
  })
})
