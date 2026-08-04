import { describe, it, expect } from 'vitest'
import { isNavItemActive, findActiveNavItem } from './match'
import type { NavSection } from './types'

const sections: NavSection[] = [
  {
    id: 'money',
    labelKey: 'nav.section.money',
    items: [
      { id: 'payments', href: '/payments', labelKey: 'nav.payments', roles: ['admin'] },
      {
        id: 'disputes',
        href: '/payments/disputes',
        labelKey: 'payments.nav.disputes',
        roles: ['admin'],
      },
      {
        id: 'settings-email',
        href: '/settings',
        labelKey: 'settings.email',
        roles: ['admin'],
        settingsTab: 'email',
      },
      {
        id: 'settings-members',
        href: '/settings',
        labelKey: 'settings.nav.members',
        roles: ['admin'],
        settingsTab: 'members',
      },
    ],
  },
]

describe('nav match', () => {
  it('prefers the longer path for disputes', () => {
    const active = findActiveNavItem('/payments/disputes', '', sections)
    expect(active?.id).toBe('disputes')
  })

  it('matches settings tab query', () => {
    expect(
      isNavItemActive('/settings', '?tab=members', {
        href: '/settings',
        settingsTab: 'members',
      }),
    ).toBe(true)
    expect(
      isNavItemActive('/settings', '', {
        href: '/settings',
        settingsTab: 'email',
      }),
    ).toBe(true)
  })
})
