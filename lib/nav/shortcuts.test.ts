import { describe, expect, it } from 'vitest'
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
})
