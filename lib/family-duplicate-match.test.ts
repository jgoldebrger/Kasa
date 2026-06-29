import { describe, it, expect } from 'vitest'
import {
  findSimilarFamilies,
  normalizeFamilyName,
  stringSimilarity,
} from '@/lib/family-duplicate-match'
import { buildHeaderMap, suggestColumnMapping } from '@/lib/import-column-mapping'

describe('family-duplicate-match', () => {
  it('normalizes family names for comparison', () => {
    expect(normalizeFamilyName('  Cohen-Smith  ')).toBe('cohensmith')
  })

  it('scores similar names above threshold', () => {
    expect(stringSimilarity('cohen', 'cohen')).toBe(1)
    expect(stringSimilarity('cohens', 'cohen')).toBeGreaterThan(0.8)
  })

  it('finds fuzzy name matches excluding exact duplicates', () => {
    const existing = [
      { familyId: '1', name: 'Cohen Family', email: 'cohen@example.com' },
      { familyId: '2', name: 'Levy Family', email: 'levy@example.com' },
    ]
    const matches = findSimilarFamilies(
      { name: 'Cohens Family', email: 'other@example.com' },
      existing,
      { excludeExactName: true },
    )
    expect(matches.length).toBeGreaterThan(0)
    expect(matches[0].familyId).toBe('1')
  })

  it('matches similar emails on the same domain', () => {
    const existing = [{ familyId: '1', name: 'Other', email: 'john.smith@shul.org' }]
    const matches = findSimilarFamilies(
      { name: 'New Family', email: 'john.smit@shul.org' },
      existing,
    )
    expect(matches.some((m) => m.matchReason === 'email' || m.matchReason === 'both')).toBe(true)
  })
})

describe('import-column-mapping', () => {
  it('suggests mapping by normalized header names', () => {
    const mapping = suggestColumnMapping(['Family Name', 'Wedding Date'], 'families')
    expect(mapping['Family Name']).toBe('name')
    expect(mapping['Wedding Date']).toBe('weddingDate')
  })

  it('builds header map from explicit column mapping', () => {
    const map = buildHeaderMap(['Family Name', 'Date'], {
      'Family Name': 'name',
      Date: 'weddingDate',
    })
    expect(map.name).toBe(0)
    expect(map.weddingdate).toBe(1)
  })
})
