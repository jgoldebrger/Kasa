import { HDate } from '@hebcal/hdate'
import { describe, expect, it } from 'vitest'
import { startOfDayInTimeZone, zonedWallClockToUtc } from '@/lib/date-utils'
import { currentBillingCycleStart } from './cycle-start'

describe('currentBillingCycleStart', () => {
  describe('when calendar is gregorian', () => {
    it('uses this year when now is on or after the cycle start', () => {
      const start = currentBillingCycleStart({
        calendar: 'gregorian',
        cycleStartMonth: 9,
        cycleStartDay: 1,
        cycleStartHebrewMonth: 7,
        cycleStartHebrewDay: 1,
        timezone: 'UTC',
        now: new Date('2026-10-01T12:00:00.000Z'),
      })
      expect(start.toISOString().startsWith('2026-09-01')).toBe(true)
    })

    it('uses previous year when now is before this year cycle start', () => {
      const start = currentBillingCycleStart({
        calendar: 'gregorian',
        cycleStartMonth: 9,
        cycleStartDay: 1,
        cycleStartHebrewMonth: 7,
        cycleStartHebrewDay: 1,
        timezone: 'UTC',
        now: new Date('2026-03-01T12:00:00.000Z'),
      })
      expect(start.toISOString().startsWith('2025-09-01')).toBe(true)
    })
  })

  describe('when calendar is hebrew', () => {
    it('uses this hebrew year when now is on or after the cycle start', () => {
      const afterCycleStart = new HDate(15, 7, 5786).greg()
      const expected = startOfDayInTimeZone('UTC', new HDate(1, 7, 5786).greg())
      const start = currentBillingCycleStart({
        calendar: 'hebrew',
        cycleStartMonth: 9,
        cycleStartDay: 1,
        cycleStartHebrewMonth: 7,
        cycleStartHebrewDay: 1,
        timezone: 'UTC',
        now: afterCycleStart,
      })
      expect(start.getTime()).toBe(expected.getTime())
    })

    it('uses org wall-clock day for hebrew cycle start in non-UTC timezone', () => {
      const cycleStart = new HDate(1, 7, 5786)
      const greg = cycleStart.greg()
      const expected = zonedWallClockToUtc(
        greg.getFullYear(),
        greg.getMonth() + 1,
        greg.getDate(),
        0,
        0,
        0,
        0,
        'America/New_York',
      )
      const afterCycleStart = new HDate(15, 7, 5786).greg()
      const start = currentBillingCycleStart({
        calendar: 'hebrew',
        cycleStartMonth: 9,
        cycleStartDay: 1,
        cycleStartHebrewMonth: 7,
        cycleStartHebrewDay: 1,
        timezone: 'America/New_York',
        now: afterCycleStart,
      })
      expect(start.getTime()).toBe(expected.getTime())
    })
  })
})
