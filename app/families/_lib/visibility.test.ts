import { describe, it, expect } from 'vitest'
import { FAMILY_TABS } from './tabs'
import { filterVisibleFamilyTabs } from './visibility'

describe('filterVisibleFamilyTabs', () => {
  it('hides admin-only tabs for members', () => {
    const visible = filterVisibleFamilyTabs(FAMILY_TABS, {
      isAdmin: false,
      memberFinancialAccess: false,
    })
    expect(visible.map((t) => t.id)).toEqual(['info', 'members', 'sub-families'])
  })

  it('shows statements for linked members', () => {
    const visible = filterVisibleFamilyTabs(FAMILY_TABS, {
      isAdmin: false,
      memberFinancialAccess: true,
    })
    expect(visible.some((t) => t.id === 'statements')).toBe(true)
    expect(visible.some((t) => t.id === 'payments')).toBe(false)
  })
})
