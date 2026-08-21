import { describe, expect, it } from 'vitest'
import { calendarDaysBetween, canReceiveDunningEmail, qualifiesForDunning } from './qualify'

describe('calendarDaysBetween', () => {
  it('counts whole calendar days in the given timezone', () => {
    const from = new Date('2026-01-01T23:00:00.000Z')
    const to = new Date('2026-01-03T05:00:00.000Z')
    expect(calendarDaysBetween(from, to, 'UTC')).toBe(2)
  })

  it('returns 0 for the same calendar day', () => {
    const a = new Date('2026-06-15T01:00:00.000Z')
    const b = new Date('2026-06-15T23:00:00.000Z')
    expect(calendarDaysBetween(a, b, 'UTC')).toBe(0)
  })

  it('counts civil calendar days across DST spring-forward', () => {
    const from = new Date('2026-03-07T17:00:00.000Z')
    const to = new Date('2026-03-09T16:00:00.000Z')
    expect(calendarDaysBetween(from, to, 'America/New_York')).toBe(2)
  })
})

describe('qualifiesForDunning', () => {
  const obligationStart = new Date('2026-01-01T00:00:00.000Z')
  const now = new Date('2026-02-01T12:00:00.000Z')

  it('returns false when balance is below minOwed', () => {
    expect(
      qualifiesForDunning({
        balance: 50,
        minOwed: 100,
        obligationStart,
        now,
        timezone: 'UTC',
        daysSinceObligation: 30,
      }),
    ).toBe(false)
  })

  it('returns false when obligation is too recent', () => {
    expect(
      qualifiesForDunning({
        balance: 200,
        minOwed: 100,
        obligationStart: new Date('2026-01-20T00:00:00.000Z'),
        now,
        timezone: 'UTC',
        daysSinceObligation: 30,
      }),
    ).toBe(false)
  })

  it('returns true when balance and age both meet thresholds', () => {
    expect(
      qualifiesForDunning({
        balance: 100,
        minOwed: 100,
        obligationStart,
        now,
        timezone: 'UTC',
        daysSinceObligation: 30,
      }),
    ).toBe(true)
  })
})

describe('canReceiveDunningEmail', () => {
  it('returns false when opted out, missing email, or format invalid', () => {
    expect(canReceiveDunningEmail({ email: 'a@b.com', communicationsOptOut: true })).toBe(false)
    expect(canReceiveDunningEmail({ email: '', emailFormatInvalid: false })).toBe(false)
    expect(canReceiveDunningEmail({ email: 'a@b.com', emailFormatInvalid: true })).toBe(false)
  })

  it('returns true for a valid email that is not opted out', () => {
    expect(canReceiveDunningEmail({ email: 'a@b.com' })).toBe(true)
  })
})
