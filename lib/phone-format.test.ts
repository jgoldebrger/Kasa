import { describe, expect, it } from 'vitest'
import { formatPhoneDisplay, formatPhoneInput, normalizePhoneDigits } from './phone-format'

describe('phone-format', () => {
  it('strips non-digits for storage', () => {
    expect(normalizePhoneDigits('(555) 123-4567')).toBe('5551234567')
  })

  it('formats 10-digit US numbers for display', () => {
    expect(formatPhoneDisplay('5551234567')).toBe('(555) 123-4567')
    expect(formatPhoneDisplay('(555) 123-4567')).toBe('(555) 123-4567')
  })

  it('formats 11-digit US numbers with country code', () => {
    expect(formatPhoneDisplay('15551234567')).toBe('+1 (555) 123-4567')
  })

  it('formats partial numbers while typing', () => {
    expect(formatPhoneInput('555')).toBe('(555')
    expect(formatPhoneInput('5551')).toBe('(555) 1')
    expect(formatPhoneInput('5551234')).toBe('(555) 123-4')
    expect(formatPhoneInput('5551234567')).toBe('(555) 123-4567')
  })

  it('returns empty string for blank values', () => {
    expect(formatPhoneDisplay('')).toBe('')
    expect(formatPhoneDisplay(null)).toBe('')
    expect(formatPhoneInput('')).toBe('')
  })
})
