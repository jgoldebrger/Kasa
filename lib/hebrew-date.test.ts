import { describe, expect, it, vi, afterEach } from 'vitest'
import { HDate } from '@hebcal/core'
import {
  calculateBarMitzvahDate,
  calculateHebrewAge,
  convertToHebrewDate,
  formatHebrewDate,
  hasReachedBarMitzvahAge,
  resolveBirthMonthInTargetYear,
} from './hebrew-date'

describe('resolveBirthMonthInTargetYear', () => {
  it('maps Adar II births to plain Adar in a non-leap target year', () => {
    expect(resolveBirthMonthInTargetYear(13, 5782, 5786)).toBe(12)
  })

  it('maps plain Adar births to Adar II in a leap target year', () => {
    expect(HDate.isLeapYear(5781)).toBe(false)
    expect(HDate.isLeapYear(5782)).toBe(true)
    expect(resolveBirthMonthInTargetYear(12, 5781, 5782)).toBe(13)
  })

  it('keeps Adar I when birth and target years are both leap', () => {
    expect(HDate.isLeapYear(5782)).toBe(true)
    expect(HDate.isLeapYear(5790)).toBe(true)
    expect(resolveBirthMonthInTargetYear(12, 5782, 5790)).toBe(12)
  })

  it('leaves ordinary months unchanged', () => {
    expect(resolveBirthMonthInTargetYear(7, 5780, 5785)).toBe(7)
  })
})

describe('convertToHebrewDate', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('formats a Gregorian date as "DD MMMM YYYY"', () => {
    const greg = new HDate(15, 7, 5785).greg()
    expect(convertToHebrewDate(greg)).toBe('15 Tishrei 5785')
  })

  it('labels Adar I and Adar II in leap years', () => {
    const adarI = new HDate(1, 12, 5782).greg()
    const adarII = new HDate(1, 13, 5782).greg()
    expect(convertToHebrewDate(adarI)).toBe('1 Adar I 5782')
    expect(convertToHebrewDate(adarII)).toBe('1 Adar II 5782')
  })

  it('returns empty string and logs when conversion throws', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(HDate.prototype, 'getDate').mockImplementation(() => {
      throw new Error('hebcal failure')
    })
    expect(convertToHebrewDate(new Date('2024-06-15T12:00:00.000Z'))).toBe('')
    expect(errSpy).toHaveBeenCalledWith('Error converting to Hebrew date:', expect.any(Error))
  })
})

describe('formatHebrewDate', () => {
  it('trims surrounding whitespace', () => {
    expect(formatHebrewDate('  3 Cheshvan 5784  ')).toBe('3 Cheshvan 5784')
  })
})

describe('calculateBarMitzvahDate', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the Gregorian date of the 13th Hebrew birthday', () => {
    const bm = calculateBarMitzvahDate('15 Tishrei 5772')
    expect(bm).toBeInstanceOf(Date)
    const h = new HDate(bm!)
    expect(h.getDate()).toBe(15)
    expect(h.getMonth()).toBe(7)
    expect(h.getFullYear()).toBe(5785)
  })

  it('maps Adar II birth to Adar when bar mitzvah year is not leap', () => {
    const bm = calculateBarMitzvahDate('10 Adar II 5773')
    expect(bm).toBeInstanceOf(Date)
    const h = new HDate(bm!)
    expect(h.getFullYear()).toBe(5786)
    expect(h.getMonth()).toBe(12)
    expect(h.getDate()).toBe(10)
  })

  it('returns null for invalid Hebrew date strings', () => {
    expect(calculateBarMitzvahDate('')).toBeNull()
    expect(calculateBarMitzvahDate('not-a-date')).toBeNull()
    expect(calculateBarMitzvahDate('1 FakeMonth 5780')).toBeNull()
  })

  it('returns null and logs when HDate throws during bar mitzvah calculation', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(HDate.prototype, 'greg').mockImplementation(() => {
      throw new Error('hebcal failure')
    })

    expect(calculateBarMitzvahDate('15 Tishrei 5772')).toBeNull()
    expect(errSpy).toHaveBeenCalledWith(
      'Error calculating Bar Mitzvah date:',
      expect.any(Error),
    )
  })
})

describe('hasReachedBarMitzvahAge', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('is false before the 13th Hebrew birthday', () => {
    const today = new HDate(1, 1, 5785)
    vi.useFakeTimers()
    vi.setSystemTime(today.greg())
    expect(hasReachedBarMitzvahAge('15 Tishrei 5773')).toBe(false)
  })

  it('is true on or after the 13th Hebrew birthday', () => {
    const today = new HDate(16, 7, 5786)
    vi.useFakeTimers()
    vi.setSystemTime(today.greg())
    expect(hasReachedBarMitzvahAge('15 Tishrei 5773')).toBe(true)
  })

  it('is false when the birth date cannot be parsed', () => {
    expect(hasReachedBarMitzvahAge('garbage')).toBe(false)
  })
})

describe('calculateHebrewAge', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('does not treat Adar II birthdays as already passed in non-leap years', () => {
    // Born 15 Adar II 5782 (leap). On 10 Adar 5786 the birthday has not
    // occurred yet — age should be 3, not 4.
    const today = new HDate(10, 12, 5786)
    vi.useFakeTimers()
    vi.setSystemTime(today.greg())

    expect(calculateHebrewAge('15 Adar II 5782')).toBe(3)
  })

  it('counts the birthday after Adar II maps to Adar in a non-leap year', () => {
    const today = new HDate(20, 12, 5786)
    vi.useFakeTimers()
    vi.setSystemTime(today.greg())

    expect(calculateHebrewAge('15 Adar II 5782')).toBe(4)
  })

  it('returns null for malformed or unknown-month strings', () => {
    expect(calculateHebrewAge('')).toBeNull()
    expect(calculateHebrewAge('only-two-parts')).toBeNull()
    expect(calculateHebrewAge('1 NotAMonth 5780')).toBeNull()
  })

  it('resolves bare Adar in a leap birth year to Adar II for age', () => {
    const today = new HDate(20, 13, 5786)
    vi.useFakeTimers()
    vi.setSystemTime(today.greg())
    expect(calculateHebrewAge('5 Adar 5782')).toBe(4)
  })

  it('accepts Hebcal Adar1/Adar2 month aliases', () => {
    const today = new HDate(5, 13, 5786)
    vi.useFakeTimers()
    vi.setSystemTime(today.greg())
    expect(calculateHebrewAge('2 Adar2 5782')).toBe(4)
  })

  it('returns null and logs when HDate throws during age calculation', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(HDate.prototype, 'greg').mockImplementation(() => {
      throw new Error('hebcal failure')
    })

    expect(calculateHebrewAge('15 Tishrei 5772')).toBeNull()
    expect(errSpy).toHaveBeenCalledWith(
      'Error calculating Hebrew age:',
      expect.any(Error),
    )
  })
})
