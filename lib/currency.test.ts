import { describe, expect, it } from 'vitest'
import {
  currencySymbol,
  formatMoney,
  isSupportedCurrency,
  listSupportedCurrencies,
} from './currency'

describe('isSupportedCurrency', () => {
  it('accepts known ISO codes', () => {
    expect(isSupportedCurrency('USD')).toBe(true)
    expect(isSupportedCurrency('ILS')).toBe(true)
    expect(isSupportedCurrency('XXX')).toBe(false)
  })
})

describe('listSupportedCurrencies', () => {
  it('returns a non-empty list including USD', () => {
    const list = listSupportedCurrencies()
    expect(list.length).toBeGreaterThan(0)
    expect(list).toContain('USD')
  })
})

describe('formatMoney', () => {
  it('formats USD for en-US', () => {
    expect(formatMoney(1234.5, { currency: 'USD', locale: 'en-US' })).toMatch(/\$1,234\.5/)
  })

  it('treats non-finite input as zero', () => {
    expect(formatMoney(Number.NaN)).toMatch(/\$0/)
  })

  it('supports noSymbol mode', () => {
    expect(formatMoney(10, { noSymbol: true, locale: 'en-US' })).toBe('10')
  })

  it('degrades gracefully for bogus currency codes', () => {
    const out = formatMoney(5, { currency: 'NOTREAL', locale: 'en-US' })
    expect(out).toContain('NOTREAL')
    expect(out).toContain('5')
  })
})

describe('currencySymbol', () => {
  it('returns a symbol for USD', () => {
    expect(currencySymbol('USD', 'en-US')).toBe('$')
  })

  it('falls back to the code on failure', () => {
    expect(currencySymbol('NOTREAL', 'en-US')).toBe('NOTREAL')
  })
})
