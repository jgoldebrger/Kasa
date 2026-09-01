import { describe, it, expect } from 'vitest'
import { filterNavSections } from './roles'
import type { NavSection } from './types'

const sections: NavSection[] = [
  {
    id: 'people',
    labelKey: 'nav.section.people',
    items: [
      { id: 'families', href: '/families', labelKey: 'nav.families', roles: ['member', 'admin'] },
      { id: 'events', href: '/events', labelKey: 'nav.events', roles: ['admin'] },
    ],
  },
]

describe('filterNavSections', () => {
  it('hides admin-only items from members', () => {
    const out = filterNavSections(sections, { isAdmin: false, isPlatformAdmin: false })
    expect(out[0].items.map((i) => i.id)).toEqual(['families'])
  })

  it('shows admin items to admins', () => {
    const out = filterNavSections(sections, { isAdmin: true, isPlatformAdmin: false })
    expect(out[0].items.map((i) => i.id)).toEqual(['families', 'events'])
  })
})
