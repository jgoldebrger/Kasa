/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  readOpenSections,
  writeOpenSections,
  ensureSectionOpen,
  isCollapsibleSection,
  sectionIdForPath,
  NAV_COLLAPSE_STORAGE_KEY,
} from './collapse'
import type { NavSection } from './types'

const sections: NavSection[] = [
  {
    id: 'money',
    labelKey: 'nav.section.money',
    items: [{ id: 'payments', href: '/payments', labelKey: 'nav.payments', roles: ['admin'] }],
  },
]

describe('nav collapse', () => {
  beforeEach(() => localStorage.clear())

  it('round-trips open section ids', () => {
    writeOpenSections(['money', 'people'])
    expect(readOpenSections()).toEqual(['money', 'people'])
    expect(localStorage.getItem(NAV_COLLAPSE_STORAGE_KEY)).toBeTruthy()
  })

  it('ensures section open without duplicates', () => {
    expect(ensureSectionOpen(['people'], 'money').sort()).toEqual(['money', 'people'])
    expect(ensureSectionOpen(['money'], 'money')).toEqual(['money'])
  })

  it('resolves section for pathname', () => {
    expect(sectionIdForPath('/payments', '', sections)).toBe('money')
  })

  it('treats single-item and unlabeled sections as flat', () => {
    expect(
      isCollapsibleSection({
        id: 'overview',
        labelKey: null,
        items: [{ id: 'dashboard', href: '/', labelKey: 'nav.dashboard', roles: ['member'] }],
      }),
    ).toBe(false)
    expect(isCollapsibleSection(sections[0])).toBe(false)
    expect(
      isCollapsibleSection({
        id: 'people',
        labelKey: 'nav.section.people',
        items: [
          { id: 'families', href: '/families', labelKey: 'nav.families', roles: ['member'] },
          { id: 'events', href: '/events', labelKey: 'nav.events', roles: ['admin'] },
        ],
      }),
    ).toBe(true)
  })
})
