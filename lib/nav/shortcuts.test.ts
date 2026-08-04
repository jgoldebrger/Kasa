import { describe, expect, it } from 'vitest'
import { PRIMARY_NAV_SECTIONS } from './config'
import { filterNavSections } from './roles'
import { getNavShortcutHelpItems } from './shortcuts'

describe('getNavShortcutHelpItems', () => {
  it('builds navigation shortcut help from configured nav items', () => {
    expect(getNavShortcutHelpItems()).toEqual([
      { keys: 'g f', labelKey: 'shortcuts.goFamilies', href: '/families' },
      { keys: 'g e', labelKey: 'shortcuts.goEvents', href: '/events' },
      { keys: 'g t', labelKey: 'shortcuts.goTasks', href: '/tasks' },
      { keys: 'g p', labelKey: 'shortcuts.goPayments', href: '/payments' },
      {
        keys: 'g c',
        labelKey: 'shortcuts.goCommunications',
        href: '/communications',
      },
      { keys: 'g s', labelKey: 'shortcuts.goSettings', href: '/settings' },
    ])
  })

  it('omits admin-only shortcuts when given a member-filtered tree', () => {
    const memberSections = filterNavSections(PRIMARY_NAV_SECTIONS, {
      isAdmin: false,
      isPlatformAdmin: false,
    })

    expect(getNavShortcutHelpItems(memberSections)).toEqual([
      { keys: 'g f', labelKey: 'shortcuts.goFamilies', href: '/families' },
    ])
  })

  it('keeps admin shortcuts when given an admin-filtered tree', () => {
    const adminSections = filterNavSections(PRIMARY_NAV_SECTIONS, {
      isAdmin: true,
      isPlatformAdmin: false,
    })

    expect(getNavShortcutHelpItems(adminSections)).toEqual(getNavShortcutHelpItems())
  })
})
