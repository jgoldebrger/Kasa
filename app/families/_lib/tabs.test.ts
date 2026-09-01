import { describe, it, expect } from 'vitest'
import { FAMILY_TABS, familyTabHref, familyTabFromPathname } from './tabs'

describe('family tabs registry', () => {
  it('keeps stable URL segments', () => {
    expect(familyTabHref('abc', 'payments')).toBe('/families/abc/payments')
    expect(familyTabHref('abc', 'info')).toBe('/families/abc')
  })

  it('parses pathname to tab id', () => {
    expect(familyTabFromPathname('/families/abc/withdrawals', 'abc')).toBe('withdrawals')
    expect(familyTabFromPathname('/families/abc', 'abc')).toBe('info')
  })

  it('orders profile before money before activity', () => {
    const groups = FAMILY_TABS.map((t) => t.group)
    expect(groups.indexOf('profile')).toBeLessThan(groups.indexOf('money'))
    expect(groups.indexOf('money')).toBeLessThan(groups.indexOf('activity'))
  })
})
