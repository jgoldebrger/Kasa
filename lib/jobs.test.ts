import { describe, expect, it } from 'vitest'
import { HDate } from '@hebcal/core'
import { startOfDayInTimeZone } from './date-utils'
import {
  cycleConfigMatchesSchedule,
  cycleScheduleMatcher,
  cycleStartGregorianMatcher,
  cycleStartHebrewMatcher,
  cycleYearFor,
  monthlyStatementDayMatcher,
  monthlyStatementHebrewDayMatcher,
  monthlyStatementScheduleMatcher,
  orgMatchesMonthlyStatementSchedule,
  selfUrl,
} from './jobs'

describe('orgMatchesMonthlyStatementSchedule', () => {
  it('matches configured Gregorian day in org timezone', () => {
    const ref = new Date('2024-06-15T12:00:00.000Z')
    expect(
      orgMatchesMonthlyStatementSchedule(
        {
          timezone: 'America/New_York',
          monthlyStatementCalendar: 'gregorian',
          monthlyStatementDay: 15,
        },
        ref,
      ),
    ).toBe(true)
  })

  it('clamps to last day of month when configured day exceeds month length', () => {
    const ref = new Date('2024-02-29T12:00:00.000Z')
    expect(
      orgMatchesMonthlyStatementSchedule(
        {
          timezone: 'UTC',
          monthlyStatementCalendar: 'gregorian',
          monthlyStatementDay: 31,
        },
        ref,
      ),
    ).toBe(true)
  })

  it('does not match wrong Gregorian day', () => {
    const ref = new Date('2024-06-14T12:00:00.000Z')
    expect(
      orgMatchesMonthlyStatementSchedule(
        {
          timezone: 'UTC',
          monthlyStatementCalendar: 'gregorian',
          monthlyStatementDay: 15,
        },
        ref,
      ),
    ).toBe(false)
  })
})

describe('cycleConfigMatchesSchedule', () => {
  it('matches Gregorian cycle start month and day in org timezone', () => {
    const ref = new Date('2024-07-01T12:00:00.000Z')
    expect(
      cycleConfigMatchesSchedule(
        {
          cycleCalendar: 'gregorian',
          cycleStartMonth: 7,
          cycleStartDay: 1,
        },
        'UTC',
        ref,
      ),
    ).toBe(true)
  })

  it('does not match when month differs', () => {
    const ref = new Date('2024-07-01T12:00:00.000Z')
    expect(
      cycleConfigMatchesSchedule(
        {
          cycleCalendar: 'gregorian',
          cycleStartMonth: 8,
          cycleStartDay: 1,
        },
        'UTC',
        ref,
      ),
    ).toBe(false)
  })

  it('matches Hebrew cycle start with end-of-month clamp', () => {
    const ref = new Date('2024-02-29T12:00:00.000Z')
    expect(
      cycleConfigMatchesSchedule(
        {
          cycleCalendar: 'hebrew',
          cycleStartHebrewMonth: 6,
          cycleStartHebrewDay: 30,
        },
        'UTC',
        ref,
      ),
    ).toBe(false)
  })

  it('matches Hebrew calendar on last day when configured day exceeds month length', () => {
    const month = 8
    const year = 5784
    let ref: Date | undefined
    let hebrewDay = 0
    for (let d = 1; d <= 30; d++) {
      const candidate = new HDate(d, month, year).greg()
      const today = new HDate(startOfDayInTimeZone('UTC', candidate))
      if (today.getMonth() === month && today.getDate() === today.daysInMonth()) {
        ref = candidate
        hebrewDay = today.getDate()
        break
      }
    }
    expect(ref).toBeDefined()
    expect(
      cycleConfigMatchesSchedule(
        {
          cycleCalendar: 'hebrew',
          cycleStartHebrewMonth: month,
          cycleStartHebrewDay: hebrewDay + 1,
        },
        'UTC',
        ref,
      ),
    ).toBe(true)
  })

  it('matches Hebrew cycle start on an exact non-month-end day', () => {
    const month = 7
    const year = 5784
    let ref: Date | undefined
    let hebrewDay = 0
    for (let d = 1; d <= 30; d++) {
      const candidate = new HDate(d, month, year).greg()
      const today = new HDate(startOfDayInTimeZone('UTC', candidate))
      if (today.getMonth() === month && today.getDate() < today.daysInMonth()) {
        ref = candidate
        hebrewDay = today.getDate()
        break
      }
    }
    expect(ref).toBeDefined()
    expect(
      cycleConfigMatchesSchedule(
        {
          cycleCalendar: 'hebrew',
          cycleStartHebrewMonth: month,
          cycleStartHebrewDay: hebrewDay,
        },
        'UTC',
        ref,
      ),
    ).toBe(true)
  })

  it('defaults null cycleCalendar to Gregorian', () => {
    const ref = new Date('2024-07-01T12:00:00.000Z')
    expect(
      cycleConfigMatchesSchedule(
        {
          cycleCalendar: null,
          cycleStartMonth: 7,
          cycleStartDay: 1,
        },
        'UTC',
        ref,
      ),
    ).toBe(true)
  })
})

describe('monthlyStatementDayMatcher', () => {
  it('matches exact day mid-month', () => {
    const now = new Date(2024, 5, 15)
    expect(monthlyStatementDayMatcher(now)).toEqual({ monthlyStatementDay: 15 })
  })

  it('uses $gte on the last day of the month for end-of-month clamp', () => {
    const now = new Date(2024, 1, 29)
    expect(monthlyStatementDayMatcher(now)).toEqual({ monthlyStatementDay: { $gte: 29 } })
  })
})

describe('monthlyStatementHebrewDayMatcher', () => {
  it('matches exact Hebrew day when not month-end', () => {
    const now = new Date('2024-06-15T12:00:00.000Z')
    const matcher = monthlyStatementHebrewDayMatcher(now) as { monthlyStatementHebrewDay: number }
    expect(matcher.monthlyStatementHebrewDay).toBeGreaterThanOrEqual(1)
  })

  it('uses $gte on the last day of a Hebrew month', () => {
    const month = 8
    const year = 5784
    const lastDay = new HDate(1, month, year).daysInMonth()
    const now = new HDate(lastDay, month, year).greg()
    expect(monthlyStatementHebrewDayMatcher(now)).toEqual({
      monthlyStatementHebrewDay: { $gte: lastDay },
    })
  })
})

describe('monthlyStatementScheduleMatcher', () => {
  it('returns a $or filter with Gregorian and Hebrew branches', () => {
    const matcher = monthlyStatementScheduleMatcher(new Date(2024, 5, 15)) as { $or: unknown[] }
    expect(matcher.$or).toHaveLength(2)
  })
})

describe('cycleStartGregorianMatcher', () => {
  it('requires month and day on non-month-end dates', () => {
    const now = new Date(2024, 6, 1)
    expect(cycleStartGregorianMatcher(now)).toEqual({ cycleStartMonth: 7, cycleStartDay: 1 })
  })

  it('clamps cycle start day on the last day of the month', () => {
    const now = new Date(2024, 1, 29)
    expect(cycleStartGregorianMatcher(now)).toEqual({
      cycleStartMonth: 2,
      cycleStartDay: { $gte: 29 },
    })
  })
})

describe('cycleStartHebrewMatcher', () => {
  it('matches Hebrew month and day', () => {
    const now = new Date('2024-06-15T12:00:00.000Z')
    const matcher = cycleStartHebrewMatcher(now) as {
      cycleStartHebrewMonth: number
      cycleStartHebrewDay: number | { $gte: number }
    }
    expect(matcher.cycleStartHebrewMonth).toBeGreaterThanOrEqual(1)
    expect(matcher.cycleStartHebrewDay).toBeDefined()
  })

  it('uses $gte on the last day of a Hebrew month', () => {
    const month = 8
    const year = 5784
    const lastDay = new HDate(1, month, year).daysInMonth()
    const now = new HDate(lastDay, month, year).greg()
    expect(cycleStartHebrewMatcher(now)).toEqual({
      cycleStartHebrewMonth: month,
      cycleStartHebrewDay: { $gte: lastDay },
    })
  })
})

describe('cycleScheduleMatcher', () => {
  it('combines Gregorian and Hebrew cycle filters', () => {
    const matcher = cycleScheduleMatcher() as { $or: unknown[] }
    expect(matcher.$or).toHaveLength(2)
  })
})

describe('cycleYearFor', () => {
  it('returns Gregorian year in org timezone', () => {
    const chargeDate = new Date('2024-06-15T12:00:00.000Z')
    expect(cycleYearFor('gregorian', chargeDate, 'UTC')).toBe(2024)
  })

  it('returns Hebrew year for Hebrew calendar', () => {
    const chargeDate = new Date('2024-09-01T12:00:00.000Z')
    const year = cycleYearFor('hebrew', chargeDate, 'UTC')
    expect(year).toBeGreaterThan(5700)
  })
})

describe('selfUrl', () => {
  it('prefers APP_BASE_URL when set', () => {
    const prev = process.env.APP_BASE_URL
    process.env.APP_BASE_URL = 'https://app.example.com'
    try {
      const request = new Request('http://localhost:3000/api/jobs/foo')
      expect(selfUrl(request, '/api/jobs/foo')).toBe('https://app.example.com/api/jobs/foo')
    } finally {
      if (prev === undefined) delete process.env.APP_BASE_URL
      else process.env.APP_BASE_URL = prev
    }
  })

  it('uses VERCEL_URL when no base override exists', () => {
    const prevBase = process.env.APP_BASE_URL
    const prevAuth = process.env.NEXTAUTH_URL
    const prevVercel = process.env.VERCEL_URL
    delete process.env.APP_BASE_URL
    delete process.env.NEXTAUTH_URL
    process.env.VERCEL_URL = 'kasa-preview.vercel.app'
    try {
      const request = new Request('http://localhost:3000/api/jobs/bar')
      expect(selfUrl(request, '/api/jobs/bar')).toBe('https://kasa-preview.vercel.app/api/jobs/bar')
    } finally {
      if (prevBase === undefined) delete process.env.APP_BASE_URL
      else process.env.APP_BASE_URL = prevBase
      if (prevAuth === undefined) delete process.env.NEXTAUTH_URL
      else process.env.NEXTAUTH_URL = prevAuth
      if (prevVercel === undefined) delete process.env.VERCEL_URL
      else process.env.VERCEL_URL = prevVercel
    }
  })

  it('falls back to the incoming request origin', () => {
    const prevBase = process.env.APP_BASE_URL
    const prevAuth = process.env.NEXTAUTH_URL
    const prevVercel = process.env.VERCEL_URL
    delete process.env.APP_BASE_URL
    delete process.env.NEXTAUTH_URL
    delete process.env.VERCEL_URL
    try {
      const request = new Request('https://custom.host/api/jobs/baz')
      expect(selfUrl(request, '/api/jobs/baz')).toBe('https://custom.host/api/jobs/baz')
    } finally {
      if (prevBase === undefined) delete process.env.APP_BASE_URL
      else process.env.APP_BASE_URL = prevBase
      if (prevAuth === undefined) delete process.env.NEXTAUTH_URL
      else process.env.NEXTAUTH_URL = prevAuth
      if (prevVercel === undefined) delete process.env.VERCEL_URL
      else process.env.VERCEL_URL = prevVercel
    }
  })
})

describe('orgMatchesMonthlyStatementSchedule (Hebrew)', () => {
  it('clamps Hebrew day 30 on a 29-day month', () => {
    const ref = new Date('2024-02-29T12:00:00.000Z')
    expect(
      orgMatchesMonthlyStatementSchedule(
        {
          timezone: 'UTC',
          monthlyStatementCalendar: 'hebrew',
          monthlyStatementHebrewDay: 30,
        },
        ref,
      ),
    ).toBe(false)
  })
})
