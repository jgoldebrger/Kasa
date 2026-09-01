import { describe, it, expect } from 'vitest'
import {
  computeAge,
  formatFamilyAddress,
  parseAgeInput,
  resolveAudience,
  type AudienceFilters,
  type FamilyShape,
  type MaritalFilter,
  type MemberShape,
  type RecipientToggles,
} from './mail-label-audience'

const TODAY = new Date('2026-09-01T12:00:00Z')

/**
 * Builds a full AudienceFilters from a partial override. `recipients` is
 * accepted as a Partial so each test names only the toggles it cares about;
 * everything unnamed defaults to false.
 */
function makeFilters(
  overrides: {
    recipients?: Partial<RecipientToggles>
    marital?: MaritalFilter
    minAge?: number | null
    maxAge?: number | null
  } = {},
): AudienceFilters {
  return {
    recipients: {
      household: false,
      husband: false,
      wife: false,
      sons: false,
      daughters: false,
      ...overrides.recipients,
    },
    marital: overrides.marital ?? 'any',
    minAge: overrides.minAge ?? null,
    maxAge: overrides.maxAge ?? null,
  }
}

const GOLDBERG: FamilyShape = {
  _id: 'fam1',
  name: 'Goldberg',
  street: '12 Main St',
  city: 'Monsey',
  state: 'NY',
  zip: '10952',
  husbandFirstName: 'Yossi',
  wifeFirstName: 'Rivka',
}

const NO_WIFE: FamilyShape = {
  _id: 'fam2',
  name: 'Klein',
  street: '5 Oak Ave',
  city: 'Lakewood',
  state: 'NJ',
  zip: '08701',
  husbandFirstName: 'Shmuel',
}

describe('mail-label-audience', () => {
  describe('formatFamilyAddress', () => {
    it('joins city, state, and zip into a single line', () => {
      expect(formatFamilyAddress(GOLDBERG)).toEqual({
        street: '12 Main St',
        cityState: 'Monsey, NY 10952',
      })
    })

    it('falls back to the legacy address field when street is empty', () => {
      const family: FamilyShape = { _id: 'x', name: 'Legacy', address: '9 Old Rd', city: 'Monsey' }
      expect(formatFamilyAddress(family)).toEqual({ street: '9 Old Rd', cityState: 'Monsey' })
    })
  })

  describe('computeAge', () => {
    it('returns null for a missing or unparseable birth date', () => {
      expect(computeAge(null, TODAY)).toBeNull()
      expect(computeAge(undefined, TODAY)).toBeNull()
      expect(computeAge('not-a-date', TODAY)).toBeNull()
    })

    it('does not count a birthday that has not happened yet this year', () => {
      expect(computeAge('2016-12-25', TODAY)).toBe(9)
    })

    it('counts a birthday that already passed this year', () => {
      expect(computeAge('2016-01-05', TODAY)).toBe(10)
    })
  })

  describe('parseAgeInput', () => {
    it('maps blank and invalid input to null', () => {
      expect(parseAgeInput('')).toBeNull()
      expect(parseAgeInput('   ')).toBeNull()
      expect(parseAgeInput('abc')).toBeNull()
      expect(parseAgeInput('-4')).toBeNull()
    })

    it('parses whole numbers including zero', () => {
      expect(parseAgeInput('0')).toBe(0)
      expect(parseAgeInput('10')).toBe(10)
    })
  })

  describe('resolveAudience — household', () => {
    it('produces one row per family using the family name and address', () => {
      const result = resolveAudience(
        [GOLDBERG, NO_WIFE],
        {},
        makeFilters({ recipients: { household: true } }),
        TODAY,
      )
      expect(result.rows).toEqual([
        { name: 'Goldberg', street: '12 Main St', cityState: 'Monsey, NY 10952' },
        { name: 'Klein', street: '5 Oak Ave', cityState: 'Lakewood, NJ 08701' },
      ])
      expect(result.skippedNoBirthDate).toBe(0)
    })
  })

  describe('resolveAudience — husband and wife', () => {
    it('prefixes the first name onto the family name', () => {
      const result = resolveAudience(
        [GOLDBERG],
        {},
        makeFilters({ recipients: { husband: true, wife: true } }),
        TODAY,
      )
      expect(result.rows.map((r) => r.name)).toEqual(['Yossi Goldberg', 'Rivka Goldberg'])
    })

    it('skips families with no wife first name', () => {
      const result = resolveAudience(
        [GOLDBERG, NO_WIFE],
        {},
        makeFilters({ recipients: { wife: true } }),
        TODAY,
      )
      expect(result.rows.map((r) => r.name)).toEqual(['Rivka Goldberg'])
      expect(result.skippedNoBirthDate).toBe(0)
    })

    it('does not duplicate a first name already present in the family name', () => {
      const family: FamilyShape = {
        _id: 'f',
        name: 'Yossi Goldberg',
        husbandFirstName: 'Yossi',
      }
      const result = resolveAudience(
        [family],
        {},
        makeFilters({ recipients: { husband: true } }),
        TODAY,
      )
      expect(result.rows.map((r) => r.name)).toEqual(['Yossi Goldberg'])
    })
  })

  describe('resolveAudience — sons and daughters', () => {
    const members: Record<string, MemberShape[]> = {
      fam1: [
        {
          _id: 'm1',
          firstName: 'Dovid',
          lastName: 'Goldberg',
          gender: 'male',
          birthDate: '2008-03-01',
        },
        {
          _id: 'm2',
          firstName: 'Sara',
          lastName: 'Goldberg',
          gender: 'female',
          birthDate: '2014-03-01',
        },
        {
          _id: 'm3',
          firstName: 'Moshe',
          lastName: 'Goldberg',
          gender: 'male',
          birthDate: '2002-03-01',
          weddingDate: '2025-06-01',
        },
      ],
    }

    it('includes only sons when daughters is unchecked', () => {
      const result = resolveAudience(
        [GOLDBERG],
        members,
        makeFilters({ recipients: { sons: true } }),
        TODAY,
      )
      expect(result.rows.map((r) => r.name)).toEqual(['Dovid Goldberg', 'Moshe Goldberg'])
    })

    it('excludes married sons when marital is unmarried (the bochur rule)', () => {
      const result = resolveAudience(
        [GOLDBERG],
        members,
        makeFilters({ recipients: { sons: true }, marital: 'unmarried' }),
        TODAY,
      )
      expect(result.rows.map((r) => r.name)).toEqual(['Dovid Goldberg'])
    })

    it('includes only married sons when marital is married', () => {
      const result = resolveAudience(
        [GOLDBERG],
        members,
        makeFilters({ recipients: { sons: true }, marital: 'married' }),
        TODAY,
      )
      expect(result.rows.map((r) => r.name)).toEqual(['Moshe Goldberg'])
    })

    it('ignores members whose gender is neither male nor female', () => {
      const odd: Record<string, MemberShape[]> = {
        fam1: [{ _id: 'm9', firstName: 'Unknown', lastName: 'Goldberg', gender: '' }],
      }
      const result = resolveAudience(
        [GOLDBERG],
        odd,
        makeFilters({ recipients: { sons: true, daughters: true } }),
        TODAY,
      )
      expect(result.rows).toEqual([])
    })

    it('falls back to the family name when a member has no last name', () => {
      const partial: Record<string, MemberShape[]> = {
        fam1: [{ _id: 'm4', firstName: 'Leah', gender: 'female' }],
      }
      const result = resolveAudience(
        [GOLDBERG],
        partial,
        makeFilters({ recipients: { daughters: true } }),
        TODAY,
      )
      expect(result.rows.map((r) => r.name)).toEqual(['Leah Goldberg'])
    })

    it('produces no row for a member with a blank first name and does not count it as skipped', () => {
      const nameless: Record<string, MemberShape[]> = {
        fam1: [{ _id: 'm5', firstName: '', lastName: 'Goldberg', gender: 'male' }],
      }
      const result = resolveAudience(
        [GOLDBERG],
        nameless,
        makeFilters({ recipients: { sons: true } }),
        TODAY,
      )
      expect(result.rows).toEqual([])
      expect(result.skippedNoBirthDate).toBe(0)
    })

    it('treats a family missing from the members map as having no members', () => {
      const result = resolveAudience(
        [NO_WIFE],
        members,
        makeFilters({ recipients: { sons: true } }),
        TODAY,
      )
      expect(result.rows).toEqual([])
    })
  })

  describe('resolveAudience — age bounds', () => {
    const members: Record<string, MemberShape[]> = {
      fam1: [
        { _id: 'a9', firstName: 'Nine', lastName: 'G', gender: 'male', birthDate: '2016-12-25' },
        { _id: 'a10', firstName: 'Ten', lastName: 'G', gender: 'male', birthDate: '2016-01-05' },
        { _id: 'a12', firstName: 'Twelve', lastName: 'G', gender: 'male', birthDate: '2014-01-05' },
        {
          _id: 'a13',
          firstName: 'Thirteen',
          lastName: 'G',
          gender: 'male',
          birthDate: '2013-01-05',
        },
      ],
    }

    it('includes the boundary age when minAge is set', () => {
      const result = resolveAudience(
        [GOLDBERG],
        members,
        makeFilters({ recipients: { sons: true }, minAge: 10 }),
        TODAY,
      )
      expect(result.rows.map((r) => r.name)).toEqual(['Ten G', 'Twelve G', 'Thirteen G'])
    })

    it('includes the boundary age when maxAge is set', () => {
      const result = resolveAudience(
        [GOLDBERG],
        members,
        makeFilters({ recipients: { sons: true }, maxAge: 12 }),
        TODAY,
      )
      expect(result.rows.map((r) => r.name)).toEqual(['Nine G', 'Ten G', 'Twelve G'])
    })

    it('is inclusive on both ends when both bounds are set', () => {
      const result = resolveAudience(
        [GOLDBERG],
        members,
        makeFilters({ recipients: { sons: true }, minAge: 10, maxAge: 12 }),
        TODAY,
      )
      expect(result.rows.map((r) => r.name)).toEqual(['Ten G', 'Twelve G'])
    })
  })

  describe('resolveAudience — missing birth dates', () => {
    const members: Record<string, MemberShape[]> = {
      fam1: [
        { _id: 'nb1', firstName: 'NoDob', lastName: 'G', gender: 'male' },
        { _id: 'nb2', firstName: 'HasDob', lastName: 'G', gender: 'male', birthDate: '2014-01-05' },
      ],
    }

    it('includes members without a birth date when no age bound is set', () => {
      const result = resolveAudience(
        [GOLDBERG],
        members,
        makeFilters({ recipients: { sons: true } }),
        TODAY,
      )
      expect(result.rows.map((r) => r.name)).toEqual(['NoDob G', 'HasDob G'])
      expect(result.skippedNoBirthDate).toBe(0)
    })

    it('excludes and counts members without a birth date once an age bound is set', () => {
      const result = resolveAudience(
        [GOLDBERG],
        members,
        makeFilters({ recipients: { sons: true }, minAge: 5 }),
        TODAY,
      )
      expect(result.rows.map((r) => r.name)).toEqual(['HasDob G'])
      expect(result.skippedNoBirthDate).toBe(1)
    })
  })

  describe('resolveAudience — ordering', () => {
    it('emits household, husband, wife, then members in endpoint order', () => {
      const members: Record<string, MemberShape[]> = {
        fam1: [
          { _id: 'o1', firstName: 'Dovid', lastName: 'Goldberg', gender: 'male' },
          { _id: 'o2', firstName: 'Sara', lastName: 'Goldberg', gender: 'female' },
        ],
      }
      const result = resolveAudience(
        [GOLDBERG],
        members,
        makeFilters({
          recipients: {
            household: true,
            husband: true,
            wife: true,
            sons: true,
            daughters: true,
          },
        }),
        TODAY,
      )
      expect(result.rows.map((r) => r.name)).toEqual([
        'Goldberg',
        'Yossi Goldberg',
        'Rivka Goldberg',
        'Dovid Goldberg',
        'Sara Goldberg',
      ])
    })

    it('gives every row in a family the same address', () => {
      const members: Record<string, MemberShape[]> = {
        fam1: [{ _id: 'p1', firstName: 'Dovid', lastName: 'Goldberg', gender: 'male' }],
      }
      const result = resolveAudience(
        [GOLDBERG],
        members,
        makeFilters({ recipients: { household: true, sons: true } }),
        TODAY,
      )
      expect(new Set(result.rows.map((r) => `${r.street}|${r.cityState}`)).size).toBe(1)
    })
  })

  describe('resolveAudience — no recipients selected', () => {
    it('returns no rows', () => {
      const result = resolveAudience([GOLDBERG], {}, makeFilters(), TODAY)
      expect(result.rows).toEqual([])
    })
  })
})
