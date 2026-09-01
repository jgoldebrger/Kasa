# Mail Labels Person-Level Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff print Avery 5160 mail labels for a subset of people inside each family — ladies only, bucherim only, kids from a given age — instead of only one label per household.

**Architecture:** A new pure module (`lib/client/mail-label-audience.ts`) expands a filtered list of families into a flat list of label rows, driven by recipient-type toggles plus marital and age filters. `MailLabelsPanel` becomes a thin UI shell over that module. The existing `/api/family-members/all` endpoint gains one field (`weddingDate`); no other server change.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind, Mongoose, Vitest.

## Global Constraints

- Vitest is configured with `globals: false` — every test file must explicitly `import { describe, it, expect } from 'vitest'`.
- Unit tests for `lib/client/**` run under the `lib` vitest project (`environment: 'node'`). The `app` project only collects `*.test.tsx`, so a `.test.ts` beside a component would never run — this is why the pure module lives in `lib/client/`.
- No `any` in new code. The repo's `tsconfig` runs `tsc --noEmit` via `npm run typecheck`.
- `Household` recipient defaults to `true`. Opening the Labels tab with default filters must produce byte-identical output to the current behavior.
- Age bounds (`minAge`, `maxAge`) are **inclusive** on both ends.
- `resolveAudience` takes `today: Date` as an explicit parameter — never read `new Date()` inside the pure module, so age math is deterministic in tests.
- Marital and age filters apply **only** to Sons and Daughters. Household, Husband, and Wife ignore them.
- `skippedNoBirthDate` counts **distinct members**, not labels, and only accumulates when at least one age bound is set.
- Prettier runs automatically on commit via `lint-staged`; do not hand-format.

---

### Task 1: Add `weddingDate` to the family-members endpoint

The marital filter needs `weddingDate` per member. The endpoint already returns `firstName`, `lastName`, `birthDate`, and `gender` grouped by `familyId`; this widens the projection by one field.

**Files:**

- Modify: `lib/route-logic/family-members/all.ts` (two `.select()` calls, the `byFamily` push block, and one stale comment)

**Interfaces:**

- Consumes: nothing (first task).
- Produces: `GET /api/family-members/all` response shape becomes
  `{ byFamily: Record<string, Array<{ _id: string; firstName?: string; lastName?: string; birthDate?: string; gender?: string; weddingDate?: string }>>, nextCursor?: string | null }`.
  Task 4 consumes this.

**Note on testing:** this is a projection widening on a DB-backed route. There is no unit-level harness for route-logic projections in this repo, and adding a mongodb-memory-server integration test purely to assert one extra field is not worth the runtime cost. The field is consumed by a typed client module that _is_ thoroughly unit-tested in Task 2, and the existing route-logic suite guards against regressions in the route itself. Verification here is: existing suite green + typecheck clean.

- [ ] **Step 1: Widen the paginated branch projection**

In `lib/route-logic/family-members/all.ts`, find the `.select()` inside the `if (clientLimit > 0)` branch:

```ts
const rows = await FamilyMember.find(filter)
  .select('_id familyId firstName lastName birthDate gender')
  .sort({ _id: 1 })
  .limit(effectiveLimit + 1)
  .lean<any[]>()
```

Change the select line to:

```ts
        .select('_id familyId firstName lastName birthDate gender weddingDate')
```

- [ ] **Step 2: Widen the unbounded branch projection**

Find the second `.select()` inside the `loadAllByIdCursor` callback:

```ts
members = await loadAllByIdCursor<any>(
  (filter, limit) =>
    FamilyMember.find(filter)
      .select('_id familyId firstName lastName birthDate gender')
      .sort({ _id: 1 })
      .limit(limit)
      .lean<any[]>(),
  baseFilter,
)
```

Change that select line to:

```ts
            .select('_id familyId firstName lastName birthDate gender weddingDate')
```

- [ ] **Step 3: Add the field to the grouped payload and fix the stale comment**

Find this block:

```ts
// Group by familyId. Keep payload compact — clients only ever want
// a list of {id, name} pairs from this endpoint.
const byFamily: Record<string, any[]> = {}
for (const m of members) {
  const key = String(m.familyId)
  if (!byFamily[key]) byFamily[key] = []
  byFamily[key].push({
    _id: m._id?.toString(),
    firstName: m.firstName,
    lastName: m.lastName,
    birthDate: m.birthDate,
    gender: m.gender,
  })
}
```

Replace it with:

```ts
// Group by familyId. Keep the payload compact — consumers need names
// plus the few fields used for audience filtering (Mail Labels filters
// on gender, birthDate, and weddingDate).
const byFamily: Record<string, any[]> = {}
for (const m of members) {
  const key = String(m.familyId)
  if (!byFamily[key]) byFamily[key] = []
  byFamily[key].push({
    _id: m._id?.toString(),
    firstName: m.firstName,
    lastName: m.lastName,
    birthDate: m.birthDate,
    gender: m.gender,
    weddingDate: m.weddingDate,
  })
}
```

- [ ] **Step 4: Verify nothing broke**

Run:

```bash
npm run typecheck
npx vitest run --config vitest.route-logic.config.ts
```

Expected: typecheck exits 0; route-logic suite passes with no new failures.

- [ ] **Step 5: Commit**

```bash
git add lib/route-logic/family-members/all.ts
git commit -m "feat(api): return weddingDate from family-members/all"
```

---

### Task 2: Create the audience resolution module

This is the whole feature's logic, as a pure function. It is written test-first because every filter rule and edge case lives here.

**Files:**

- Create: `lib/client/mail-label-audience.ts`
- Create: `lib/client/mail-label-audience.test.ts`

**Interfaces:**

- Consumes: the response shape produced by Task 1 (as the `MemberShape` type).
- Produces, all exported from `lib/client/mail-label-audience.ts`:
  - `interface FamilyShape` — `_id: string`, `name: string`, optional `street`, `address`, `city`, `state`, `zip`, `paymentPlanId`, `husbandFirstName`, `wifeFirstName`
  - `interface MemberShape` — optional `_id`, `firstName`, `lastName`, `birthDate`, `gender`, `weddingDate`
  - `interface LabelRow` — `name: string`, `street: string`, `cityState: string`
  - `type MaritalFilter = 'any' | 'unmarried' | 'married'`
  - `interface RecipientToggles` — `household`, `husband`, `wife`, `sons`, `daughters`, all `boolean`
  - `interface AudienceFilters` — `recipients: RecipientToggles`, `marital: MaritalFilter`, `minAge: number | null`, `maxAge: number | null`
  - `interface MailLabelFilters extends AudienceFilters` — plus `planIds: string[]`, `balance: 'all' | 'negative'`, `requireAddress: boolean`, `search: string`
  - `const DEFAULT_MAIL_LABEL_FILTERS: MailLabelFilters`
  - `function formatFamilyAddress(family: FamilyShape): { street: string; cityState: string }`
  - `function computeAge(birthDate: string | Date | null | undefined, today: Date): number | null`
  - `function parseAgeInput(raw: string): number | null`
  - `function resolveAudience(families: FamilyShape[], membersByFamily: Record<string, MemberShape[]>, filters: AudienceFilters, today: Date): { rows: LabelRow[]; skippedNoBirthDate: number }`

  Tasks 3 and 4 consume `MailLabelFilters`, `DEFAULT_MAIL_LABEL_FILTERS`, `FamilyShape`, `MemberShape`, `LabelRow`, `resolveAudience`, and `parseAgeInput`.

- [ ] **Step 1: Write the failing test file**

Create `lib/client/mail-label-audience.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run --project=lib lib/client/mail-label-audience.test.ts
```

Expected: FAIL — cannot resolve `./mail-label-audience`.

- [ ] **Step 3: Write the implementation**

Create `lib/client/mail-label-audience.ts`:

```ts
/**
 * Expands a list of families into individual mail-label rows.
 *
 * Mail labels used to be strictly one-per-household. Staff needed targeted
 * physical mailings (ladies only, bucherim only, kids from a given age), which
 * is a person-level audience — something no other surface in the app does.
 *
 * All logic here is pure so it can be unit-tested without React or the network.
 * `today` is injected rather than read from the clock so age math is stable.
 */

export interface FamilyShape {
  _id: string
  name: string
  street?: string
  address?: string
  city?: string
  state?: string
  zip?: string
  paymentPlanId?: string | null
  husbandFirstName?: string
  wifeFirstName?: string
}

export interface MemberShape {
  _id?: string
  firstName?: string
  lastName?: string
  birthDate?: string | Date | null
  gender?: string
  weddingDate?: string | Date | null
}

export interface LabelRow {
  name: string
  street: string
  cityState: string
}

export type MaritalFilter = 'any' | 'unmarried' | 'married'

export interface RecipientToggles {
  household: boolean
  husband: boolean
  wife: boolean
  sons: boolean
  daughters: boolean
}

export interface AudienceFilters {
  recipients: RecipientToggles
  marital: MaritalFilter
  minAge: number | null
  maxAge: number | null
}

export interface MailLabelFilters extends AudienceFilters {
  planIds: string[]
  balance: 'all' | 'negative'
  requireAddress: boolean
  search: string
}

export const DEFAULT_MAIL_LABEL_FILTERS: MailLabelFilters = {
  planIds: [],
  balance: 'all',
  requireAddress: true,
  search: '',
  recipients: {
    household: true,
    husband: false,
    wife: false,
    sons: false,
    daughters: false,
  },
  marital: 'any',
  minAge: null,
  maxAge: null,
}

/** Street + "City, ST Zip" for one family. Shared by every row in that family. */
export function formatFamilyAddress(family: FamilyShape): { street: string; cityState: string } {
  const cityState = [family.city, family.state].filter(Boolean).join(', ')
  const cityStateZip = [cityState, family.zip?.trim()].filter(Boolean).join(' ')
  return {
    street: (family.street || family.address || '').trim(),
    cityState: cityStateZip,
  }
}

/** Whole years as of `today`, or null when there is no usable birth date. */
export function computeAge(
  birthDate: string | Date | null | undefined,
  today: Date,
): number | null {
  if (!birthDate) return null
  const born = birthDate instanceof Date ? birthDate : new Date(birthDate)
  if (Number.isNaN(born.getTime())) return null
  let age = today.getFullYear() - born.getFullYear()
  const monthDelta = today.getMonth() - born.getMonth()
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < born.getDate())) {
    age -= 1
  }
  return age
}

/** Maps a number input's raw string to an age bound. Blank / invalid means "no bound". */
export function parseAgeInput(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const parsed = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}

/**
 * Husband/wife labels read "{firstName} {Family.name}". Some orgs already store
 * a given name inside `Family.name`, which would print "Yossi Goldberg, Yossi" —
 * so skip the prefix when the family name already leads with it.
 */
function joinPersonAndFamilyName(firstName: string, familyName: string): string {
  const first = firstName.trim()
  const family = familyName.trim()
  if (!first) return family
  if (!family) return first
  if (family.toLowerCase().startsWith(first.toLowerCase())) return family
  return `${first} ${family}`
}

function memberLabelName(member: MemberShape, familyName: string): string {
  const first = (member.firstName || '').trim()
  if (!first) return ''
  const last = (member.lastName || '').trim()
  if (last) return `${first} ${last}`
  return joinPersonAndFamilyName(first, familyName)
}

export function resolveAudience(
  families: FamilyShape[],
  membersByFamily: Record<string, MemberShape[]>,
  filters: AudienceFilters,
  today: Date,
): { rows: LabelRow[]; skippedNoBirthDate: number } {
  const { recipients, marital, minAge, maxAge } = filters
  const hasAgeBound = minAge !== null || maxAge !== null
  const wantsMembers = recipients.sons || recipients.daughters

  const rows: LabelRow[] = []
  const skippedIds = new Set<string>()
  let skippedWithoutId = 0

  for (const family of families) {
    const address = formatFamilyAddress(family)
    const familyName = family.name || ''
    const push = (name: string) => {
      if (name) rows.push({ name, ...address })
    }

    if (recipients.household) push(familyName.trim())
    if (recipients.husband) push(joinPersonAndFamilyName(family.husbandFirstName || '', familyName))
    if (recipients.wife) push(joinPersonAndFamilyName(family.wifeFirstName || '', familyName))

    if (!wantsMembers) continue

    for (const member of membersByFamily[family._id] || []) {
      const gender = (member.gender || '').toLowerCase()
      const isSon = gender === 'male'
      const isDaughter = gender === 'female'
      if (!isSon && !isDaughter) continue
      if (isSon && !recipients.sons) continue
      if (isDaughter && !recipients.daughters) continue

      if (marital === 'unmarried' && member.weddingDate) continue
      if (marital === 'married' && !member.weddingDate) continue

      if (hasAgeBound) {
        const age = computeAge(member.birthDate, today)
        if (age === null) {
          if (member._id) skippedIds.add(member._id)
          else skippedWithoutId += 1
          continue
        }
        if (minAge !== null && age < minAge) continue
        if (maxAge !== null && age > maxAge) continue
      }

      push(memberLabelName(member, familyName))
    }
  }

  return { rows, skippedNoBirthDate: skippedIds.size + skippedWithoutId }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
npx vitest run --project=lib lib/client/mail-label-audience.test.ts
```

Expected: PASS, all tests green.

- [ ] **Step 5: Typecheck and lint**

Run:

```bash
npm run typecheck
npx eslint lib/client/mail-label-audience.ts lib/client/mail-label-audience.test.ts
```

Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add lib/client/mail-label-audience.ts lib/client/mail-label-audience.test.ts
git commit -m "feat(labels): add pure mail-label audience resolver"
```

---

### Task 3: Route the panel through `resolveAudience` with no behavior change

This is a behavior-preserving refactor. It replaces three duplicated filter-shape declarations with the shared type and swaps the panel's inline family filtering for `resolveAudience`. With `Household` defaulted on and no members loaded, printed output is identical to before. No new UI yet — that isolates "did I break the existing panel?" from "does the new UI work?".

**Files:**

- Modify: `app/settings/SettingsView.tsx` (the `labelFilters` `useState` declaration)
- Modify: `app/settings/panels/LabelsPanel.tsx` (drop local `FamilyShape` / `LabelFilters`)
- Modify: `app/components/settings/MailLabelsPanel.tsx` (imports, props, remove `formatAddressRow`, rework the memos, print handler, preview copy)

**Interfaces:**

- Consumes from Task 2: `MailLabelFilters`, `DEFAULT_MAIL_LABEL_FILTERS`, `FamilyShape`, `MemberShape`, `LabelRow`, `resolveAudience`.
- Produces: `MailLabelsPanel` exposes a memoized `audience: { rows: LabelRow[]; skippedNoBirthDate: number }` and a `filteredFamilies` array. Task 4 adds UI on top of these and replaces the `EMPTY_MEMBERS` placeholder with fetched state.

- [ ] **Step 1: Point `SettingsView` at the shared type**

In `app/settings/SettingsView.tsx`, find:

```tsx
const [labelFilters, setLabelFilters] = useState<{
  planIds: string[]
  balance: 'all' | 'negative'
  requireAddress: boolean
  search: string
}>({
  planIds: [],
  balance: 'all',
  requireAddress: true,
  search: '',
})
```

Replace with:

```tsx
const [labelFilters, setLabelFilters] = useState<MailLabelFilters>(DEFAULT_MAIL_LABEL_FILTERS)
```

Add to the import block at the top of the file:

```tsx
import { DEFAULT_MAIL_LABEL_FILTERS, type MailLabelFilters } from '@/lib/client/mail-label-audience'
```

- [ ] **Step 2: Simplify `LabelsPanel` to pass through the shared types**

Replace the entire contents of `app/settings/panels/LabelsPanel.tsx` with:

```tsx
'use client'

import type { Dispatch, SetStateAction } from 'react'
import MailLabelsPanel from '@/app/components/settings/MailLabelsPanel'
import type { FamilyShape, MailLabelFilters } from '@/lib/client/mail-label-audience'

interface PlanShape {
  _id: string
  name: string
}

export interface LabelsPanelProps {
  families: FamilyShape[]
  plans: PlanShape[]
  filters: MailLabelFilters
  setFilters: Dispatch<SetStateAction<MailLabelFilters>>
}

export default function LabelsPanel({ families, plans, filters, setFilters }: LabelsPanelProps) {
  return (
    <MailLabelsPanel families={families} plans={plans} filters={filters} setFilters={setFilters} />
  )
}
```

- [ ] **Step 3: Swap the panel's types and imports**

In `app/components/settings/MailLabelsPanel.tsx`, add to the imports:

```tsx
import {
  resolveAudience,
  type FamilyShape,
  type LabelRow,
  type MailLabelFilters,
  type MemberShape,
} from '@/lib/client/mail-label-audience'
```

Delete the local `FamilyShape` interface:

```tsx
interface FamilyShape {
  _id: string
  name: string
  street?: string
  address?: string
  city?: string
  state?: string
  zip?: string
  paymentPlanId?: string | null
}
```

Delete the local `Filters` interface:

```tsx
interface Filters {
  planIds: string[]
  balance: 'all' | 'negative'
  requireAddress: boolean
  search: string
}
```

Change the `Props` interface from:

```tsx
interface Props {
  families: FamilyShape[]
  plans: PlanShape[]
  filters: Filters
  setFilters: React.Dispatch<React.SetStateAction<Filters>>
}
```

to:

```tsx
interface Props {
  families: FamilyShape[]
  plans: PlanShape[]
  filters: MailLabelFilters
  setFilters: React.Dispatch<React.SetStateAction<MailLabelFilters>>
}
```

Change the `buildLabelHTML` signature from its inline row type to the shared one:

```tsx
function buildLabelHTML(rows: LabelRow[]): string {
```

- [ ] **Step 4: Remove the now-duplicated address formatter and add the members placeholder**

Delete this function from `MailLabelsPanel.tsx` — it now lives in the shared module as `formatFamilyAddress`:

```tsx
function formatAddressRow(f: FamilyShape) {
  const cityState = [f.city, f.state].filter(Boolean).join(', ')
  const cityStateZip = [cityState, f.zip?.trim()].filter(Boolean).join(' ')
  return {
    name: f.name || '',
    street: (f.street || f.address || '').trim(),
    cityState: cityStateZip,
  }
}
```

Add this module-level constant in its place. A stable identity keeps the `audience` memo from recomputing every render; Task 4 replaces it with fetched state.

```tsx
/** Placeholder until member fetching lands — a stable identity for the memo. */
const EMPTY_MEMBERS: Record<string, MemberShape[]> = {}
```

- [ ] **Step 5: Rework the filtering memos**

Replace the `filtered` and `previewRows` memos:

```tsx
const filtered = useMemo(() => {
  const search = filters.search.trim().toLowerCase()
  return families.filter((f) => {
    const streetLine = (f.street || f.address || '').trim()
    if (filters.requireAddress && !streetLine) return false
    if (filters.planIds.length > 0) {
      const pid = f.paymentPlanId ? String(f.paymentPlanId) : ''
      if (!filters.planIds.includes(pid)) return false
    }
    if (filters.balance === 'negative') {
      // While balances are still loading, hide everything so we don't
      // momentarily print a full-org sheet by mistake.
      if (!balanceMap) return false
      const bal = balanceMap.get(String(f._id))
      if (bal === undefined || bal >= 0) return false
    }
    if (search) {
      const hay =
        `${f.name || ''} ${f.street || ''} ${f.address || ''} ${f.city || ''} ${f.state || ''} ${f.zip || ''}`.toLowerCase()
      if (!hay.includes(search)) return false
    }
    return true
  })
}, [families, filters, balanceMap])

const previewRows = useMemo(() => filtered.slice(0, 12).map(formatAddressRow), [filtered])
```

with:

```tsx
// Family-level filters run first; person expansion happens only inside the
// families that survive them.
const filteredFamilies = useMemo(() => {
  const search = filters.search.trim().toLowerCase()
  return families.filter((f) => {
    const streetLine = (f.street || f.address || '').trim()
    if (filters.requireAddress && !streetLine) return false
    if (filters.planIds.length > 0) {
      const pid = f.paymentPlanId ? String(f.paymentPlanId) : ''
      if (!filters.planIds.includes(pid)) return false
    }
    if (filters.balance === 'negative') {
      // While balances are still loading, hide everything so we don't
      // momentarily print a full-org sheet by mistake.
      if (!balanceMap) return false
      const bal = balanceMap.get(String(f._id))
      if (bal === undefined || bal >= 0) return false
    }
    if (search) {
      const hay =
        `${f.name || ''} ${f.street || ''} ${f.address || ''} ${f.city || ''} ${f.state || ''} ${f.zip || ''}`.toLowerCase()
      if (!hay.includes(search)) return false
    }
    return true
  })
}, [families, filters, balanceMap])

const audience = useMemo(
  () => resolveAudience(filteredFamilies, EMPTY_MEMBERS, filters, new Date()),
  [filteredFamilies, filters],
)

const previewRows = useMemo(() => audience.rows.slice(0, 12), [audience.rows])
```

- [ ] **Step 6: Update the print handler**

Replace:

```tsx
const handlePrint = () => {
  if (filtered.length === 0) {
    window.alert('No families match the current filters.')
    return
  }
  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(buildLabelHTML(filtered.map(formatAddressRow)))
  w.document.close()
  w.focus()
  w.print()
}
```

with:

```tsx
const handlePrint = () => {
  if (audience.rows.length === 0) {
    window.alert('No labels match the current filters.')
    return
  }
  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(buildLabelHTML(audience.rows))
  w.document.close()
  w.focus()
  w.print()
}
```

- [ ] **Step 7: Update the preview section to count labels**

Replace:

```tsx
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-sm font-semibold text-fg">
            Preview ({filtered.length} {filtered.length === 1 ? 'family' : 'families'})
          </h3>
          {filtered.length > previewRows.length && (
            <span className="text-xs text-fg-muted">Showing first {previewRows.length}.</span>
          )}
        </div>
        {filtered.length === 0 ? (
          <EmptyState
            title="No families match the current filters"
            description="Adjust filters above or clear them to see all families with mailing addresses."
          />
        ) : (
```

with:

```tsx
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-sm font-semibold text-fg">
            Preview ({audience.rows.length} {audience.rows.length === 1 ? 'label' : 'labels'})
          </h3>
          {audience.rows.length > previewRows.length && (
            <span className="text-xs text-fg-muted">Showing first {previewRows.length}.</span>
          )}
        </div>
        {audience.rows.length === 0 ? (
          <EmptyState
            title="No labels match the current filters"
            description="Adjust filters above or clear them to see all families with mailing addresses."
          />
        ) : (
```

- [ ] **Step 8: Verify nothing regressed**

Run:

```bash
npm run typecheck
npx eslint app/components/settings/MailLabelsPanel.tsx app/settings/panels/LabelsPanel.tsx app/settings/SettingsView.tsx
npx vitest run --project=lib lib/client/mail-label-audience.test.ts
```

Expected: all three exit 0.

Then start the dev server and check the Labels tab by hand:

```bash
npm run dev
```

Open Settings → Labels. Confirm the preview still lists families by family name with the same addresses, the count now reads "N labels", each existing filter (search, balance, plan chips, require-address) still narrows the list, and "Print labels" opens a sheet identical to before this task.

- [ ] **Step 9: Commit**

```bash
git add app/components/settings/MailLabelsPanel.tsx app/settings/panels/LabelsPanel.tsx app/settings/SettingsView.tsx
git commit -m "refactor(labels): resolve label rows through shared audience module"
```

---

### Task 4: Add the recipient, marital, and age controls

Adds the UI and the lazy member fetch that powers Sons/Daughters.

**Files:**

- Modify: `app/components/settings/MailLabelsPanel.tsx`

**Interfaces:**

- Consumes from Task 1: `GET /api/family-members/all` → `{ byFamily: Record<string, MemberShape[]> }`.
- Consumes from Task 2: `parseAgeInput`, `MemberShape`, `RecipientToggles`, `MaritalFilter`, `MailLabelFilters`.
- Consumes from Task 3: the `audience` memo and `filteredFamilies`.
- Produces: the finished feature. No downstream tasks.

- [ ] **Step 1: Add the option and preset constants**

Add near the top of `MailLabelsPanel.tsx`, after the `AVERY_5160` constant:

```tsx
const RECIPIENT_OPTIONS: Array<{ key: keyof RecipientToggles; label: string }> = [
  { key: 'household', label: 'Household' },
  { key: 'husband', label: 'Husband' },
  { key: 'wife', label: 'Wife' },
  { key: 'sons', label: 'Sons' },
  { key: 'daughters', label: 'Daughters' },
]

const MARITAL_OPTIONS: Array<{ value: MaritalFilter; label: string }> = [
  { value: 'any', label: 'Any' },
  { value: 'unmarried', label: 'Unmarried only' },
  { value: 'married', label: 'Married only' },
]

/** Presets only pre-fill the controls below, so they stay adjustable afterwards. */
const PRESETS: Array<{ id: string; label: string; apply: Partial<MailLabelFilters> }> = [
  {
    id: 'ladies',
    label: 'Ladies',
    apply: {
      recipients: { household: false, husband: false, wife: true, sons: false, daughters: false },
      marital: 'any',
      minAge: null,
      maxAge: null,
    },
  },
  {
    id: 'bucherim',
    label: 'Bucherim',
    apply: {
      recipients: { household: false, husband: false, wife: false, sons: true, daughters: false },
      marital: 'unmarried',
      minAge: null,
      maxAge: null,
    },
  },
  {
    id: 'kids',
    label: 'Kids',
    apply: {
      recipients: { household: false, husband: false, wife: false, sons: true, daughters: true },
      marital: 'any',
      minAge: null,
      maxAge: null,
    },
  },
]
```

Extend the shared-module import to add the two types and the parser:

```tsx
import {
  parseAgeInput,
  resolveAudience,
  type FamilyShape,
  type LabelRow,
  type MailLabelFilters,
  type MaritalFilter,
  type MemberShape,
  type RecipientToggles,
} from '@/lib/client/mail-label-audience'
```

Add the cache-aware fetch helper import:

```tsx
import { cachedFetch } from '@/lib/client-cache'
```

- [ ] **Step 2: Add member state and the lazy fetch**

Add below the existing balance state (`balanceFetchGenRef`):

```tsx
// Members are only needed for Sons / Daughters, so households-only users
// never pay for this request.
const [membersByFamily, setMembersByFamily] = useState<Record<string, MemberShape[]>>({})
const [membersLoading, setMembersLoading] = useState(false)
const membersFetchGenRef = useRef(0)
const hasFetchedMembersRef = useRef(false)

const needMembers = filters.recipients.sons || filters.recipients.daughters

useEffect(() => {
  if (!needMembers || hasFetchedMembersRef.current) return
  hasFetchedMembersRef.current = true
  const gen = ++membersFetchGenRef.current
  setMembersLoading(true)
  ;(async () => {
    try {
      const data = await cachedFetch<{ byFamily: Record<string, MemberShape[]> }>(
        '/api/family-members/all',
        { ttl: 30_000 },
      )
      if (gen !== membersFetchGenRef.current) return
      setMembersByFamily(data?.byFamily || {})
    } catch {
      // Best-effort: the preview simply shows no member rows.
    } finally {
      if (gen === membersFetchGenRef.current) setMembersLoading(false)
    }
  })()
}, [needMembers])
```

The `hasFetchedMembersRef` guard is load-bearing: keying the effect on `membersByFamily` instead would loop forever for an org with no members, because writing a fresh `{}` changes the object identity and re-triggers the effect.

- [ ] **Step 3: Reset member state on org switch**

Replace the existing `useOrgChanged` call:

```tsx
useOrgChanged(
  useCallback(() => {
    balanceFetchGenRef.current += 1
    setBalanceMap(null)
  }, []),
)
```

with:

```tsx
useOrgChanged(
  useCallback(() => {
    balanceFetchGenRef.current += 1
    setBalanceMap(null)
    membersFetchGenRef.current += 1
    hasFetchedMembersRef.current = false
    setMembersByFamily({})
  }, []),
)
```

- [ ] **Step 4: Feed real members into the audience memo**

Replace:

```tsx
const audience = useMemo(
  () => resolveAudience(filteredFamilies, EMPTY_MEMBERS, filters, new Date()),
  [filteredFamilies, filters],
)
```

with:

```tsx
const audience = useMemo(
  () => resolveAudience(filteredFamilies, membersByFamily, filters, new Date()),
  [filteredFamilies, membersByFamily, filters],
)
```

Delete the now-unused placeholder:

```tsx
/** Placeholder until member fetching lands — a stable identity for the memo. */
const EMPTY_MEMBERS: Record<string, MemberShape[]> = {}
```

- [ ] **Step 5: Add the recipients, presets, and child-filter controls**

Insert this block in the JSX immediately after the payment-plans `{plans.length > 0 && (...)}` section and before the `{/* Preview */}` comment:

```tsx
{
  /* Recipients — who inside each matching family gets a label */
}
;<div className="mb-6">
  <label className="block text-sm font-medium text-fg mb-1.5">Recipients</label>
  <div className="flex flex-wrap gap-4">
    {RECIPIENT_OPTIONS.map(({ key, label }) => (
      <label key={key} className="inline-flex items-center gap-2 text-sm text-fg cursor-pointer">
        <input
          type="checkbox"
          checked={filters.recipients[key]}
          onChange={(e) =>
            setFilters((f) => ({
              ...f,
              recipients: { ...f.recipients, [key]: e.target.checked },
            }))
          }
          className="h-4 w-4 rounded border-border text-accent focus-ring"
        />
        {label}
      </label>
    ))}
  </div>
  <p className="text-xs text-fg-muted mt-1">
    Household prints one label per family addressed to the family name. Everyone else prints one
    label per person, all sharing the household address.
  </p>
</div>

{
  /* Presets — shortcuts that pre-fill the controls above and below */
}
;<div className="mb-6">
  <label className="block text-sm font-medium text-fg mb-1.5">Presets</label>
  <div className="flex flex-wrap gap-2">
    {PRESETS.map((preset) => (
      <button
        key={preset.id}
        type="button"
        onClick={() => setFilters((f) => ({ ...f, ...preset.apply }))}
        className="focus-ring px-3 py-1.5 text-xs rounded-full border border-border bg-surface text-fg hover:bg-fg/5 transition-colors"
      >
        {preset.label}
      </button>
    ))}
  </div>
</div>

{
  /* Child-only filters — meaningless unless Sons or Daughters is selected */
}
;<div className={`grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 ${needMembers ? '' : 'opacity-50'}`}>
  <div>
    <label className="block text-sm font-medium text-fg mb-1.5">Marital status</label>
    <div className="flex flex-wrap gap-2">
      {MARITAL_OPTIONS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          disabled={!needMembers}
          onClick={() => setFilters((f) => ({ ...f, marital: value }))}
          className={`focus-ring px-3 py-2 text-sm rounded-md border transition-colors disabled:cursor-not-allowed ${
            filters.marital === value
              ? 'bg-accent text-accent-fg border-accent'
              : 'bg-surface text-fg border-border hover:bg-fg/5'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
    <p className="text-xs text-fg-muted mt-1">
      A bochur or unmarried girl is a child with no wedding date. Married children usually become
      their own family, so reach them with Household instead.
    </p>
  </div>
  <Input
    label="Minimum age"
    type="number"
    min={0}
    placeholder="Any"
    hint="Applies to sons and daughters."
    disabled={!needMembers}
    value={filters.minAge === null ? '' : String(filters.minAge)}
    onChange={(e) => setFilters((f) => ({ ...f, minAge: parseAgeInput(e.target.value) }))}
  />
  <Input
    label="Maximum age"
    type="number"
    min={0}
    placeholder="Any"
    hint="Both ages are inclusive."
    disabled={!needMembers}
    value={filters.maxAge === null ? '' : String(filters.maxAge)}
    onChange={(e) => setFilters((f) => ({ ...f, maxAge: parseAgeInput(e.target.value) }))}
  />
</div>
```

- [ ] **Step 6: Surface loading and skipped-member feedback**

In the preview section, replace:

```tsx
          {audience.rows.length > previewRows.length && (
            <span className="text-xs text-fg-muted">Showing first {previewRows.length}.</span>
          )}
        </div>
```

with:

```tsx
          {audience.rows.length > previewRows.length && (
            <span className="text-xs text-fg-muted">Showing first {previewRows.length}.</span>
          )}
        </div>
        {membersLoading && (
          <p className="text-xs text-fg-muted mb-2">Loading family members…</p>
        )}
        {audience.skippedNoBirthDate > 0 && (
          <p className="text-xs text-fg-muted mb-2">
            {audience.skippedNoBirthDate}{' '}
            {audience.skippedNoBirthDate === 1 ? 'member' : 'members'} skipped — no birth date on
            file.
          </p>
        )}
```

- [ ] **Step 7: Verify**

Run:

```bash
npm run typecheck
npx eslint app/components/settings/MailLabelsPanel.tsx
npx vitest run --project=lib lib/client/mail-label-audience.test.ts
```

Expected: all exit 0.

Then check by hand with `npm run dev`, Settings → Labels:

1. Default state shows Household checked only, and the preview matches Task 3's output.
2. Marital and age controls appear dimmed and are unclickable until Sons or Daughters is checked.
3. Clicking **Ladies** leaves only Wife checked; the preview switches to wife names and drops families with no wife recorded.
4. Clicking **Bucherim** checks Sons and sets Unmarried; a brief "Loading family members…" appears on the first member-requiring selection only.
5. Clicking **Kids** checks Sons and Daughters. Typing `10` into Minimum age drops younger children and, if any member has no birth date, shows the skipped-member notice.
6. Open the browser network tab and confirm `/api/family-members/all` is requested only once, and never at all while Household is the sole recipient.
7. Print with a person-level selection and confirm each person gets their own label carrying the household address.

- [ ] **Step 8: Commit**

```bash
git add app/components/settings/MailLabelsPanel.tsx
git commit -m "feat(labels): add recipient, marital, and age filters to mail labels"
```

---

## Verification Summary

After all four tasks:

```bash
npm run typecheck
npm run lint
npx vitest run --project=lib
```

All three must exit 0.
