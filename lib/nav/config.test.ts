import { describe, expect, it } from 'vitest'
import { PRIMARY_NAV_SECTIONS } from './config'
import { filterNavSections } from './roles'

describe('PRIMARY_NAV_SECTIONS', () => {
  it('includes required payment, communications, and settings destinations', () => {
    const items = PRIMARY_NAV_SECTIONS.flatMap((section) => section.items)
    const hrefs = items.map((item) => item.href)
    const settingsTabs = items
      .map((item) => item.settingsTab)
      .filter((tab): tab is string => Boolean(tab))

    expect(hrefs).toEqual(
      expect.arrayContaining([
        '/payments',
        '/payments/disputes',
        '/collections',
        '/calculations',
        '/projections',
        '/statements',
        '/communications',
        '/communications/templates',
        '/communications/scheduled',
        '/communications/jobs',
        '/communications/analytics',
        '/communications/automations',
      ]),
    )
    expect(settingsTabs).toEqual(
      expect.arrayContaining([
        'email',
        'eventTypes',
        'paymentPlans',
        'automation',
        'kevittel',
        'cycle',
        'branding',
        'letterhead',
        'labels',
        'localization',
        'activity',
        'members',
        'billing',
        'trash',
        'dataExport',
      ]),
    )
  })

  it('limits the member tree to dashboard, families, and help', () => {
    const output = filterNavSections(PRIMARY_NAV_SECTIONS, {
      isAdmin: false,
      isPlatformAdmin: false,
    })
    const ids = output.flatMap((section) => section.items.map((item) => item.id)).sort()

    expect(ids).toEqual(['dashboard', 'families', 'help'].sort())
  })

  it('declares icon names without React nodes', () => {
    const items = PRIMARY_NAV_SECTIONS.flatMap((section) => section.items)

    expect(items.every((item) => typeof item.iconName === 'string')).toBe(true)
  })
})
