/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import { buildGroupedSearchResults } from '@/lib/client/global-search-items'

const t = (key: string) => `t:${key}`

const groupLabels = {
  actions: 'Actions',
  pages: 'Pages',
  records: 'Records',
}

describe('buildGroupedSearchResults', () => {
  it('returns actions and pages when query is empty', () => {
    const { groups, flatItems } = buildGroupedSearchResults({
      query: '',
      isAdmin: true,
      t,
      groupLabels,
    })

    expect(groups.map((g) => g.id)).toEqual(['actions', 'pages'])
    expect(flatItems.length).toBeGreaterThan(0)
    expect(flatItems.every((i) => i.group !== 'records')).toBe(true)
  })

  it('hides admin-only actions for members', () => {
    const admin = buildGroupedSearchResults({
      query: 'payment',
      isAdmin: true,
      t,
      groupLabels,
    })
    const member = buildGroupedSearchResults({
      query: 'payment',
      isAdmin: false,
      t,
      groupLabels,
    })

    expect(admin.flatItems.some((i) => i.id === 'action-record-payment')).toBe(true)
    expect(member.flatItems.some((i) => i.id === 'action-record-payment')).toBe(false)
    expect(member.flatItems.some((i) => i.id === 'page-payments')).toBe(false)
  })

  it('filters pages by query and appends records', () => {
    const records = [
      {
        type: 'family' as const,
        id: 'f1',
        label: 'Cohen',
        sublabel: '',
        href: '/families/f1',
      },
    ]

    const { groups, flatItems } = buildGroupedSearchResults({
      query: 'fam',
      isAdmin: true,
      t,
      groupLabels,
      records,
    })

    expect(
      groups.some((g) => g.id === 'pages' && g.items.some((i) => i.id === 'page-families')),
    ).toBe(true)
    expect(groups.some((g) => g.id === 'records' && g.items.length === 1)).toBe(true)
    expect(flatItems.at(-1)?.label).toBe('Cohen')
  })

  it('omits empty groups', () => {
    const { groups } = buildGroupedSearchResults({
      query: 'zzzznotfound',
      isAdmin: false,
      t,
      groupLabels,
      records: [],
    })

    expect(groups).toEqual([])
  })
})
