# Dunning Arrears Automations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `dunning_arrears` email automation rules with per-family episodes (min owed + obligation age, M sends / N days, any Payment closes the episode).

**Architecture:** Pure qualify/cycle-start helpers under `lib/dunning/`; `DunningEpisode` collection for runtime state; extend `EmailAutomationRule` and the existing `executeEmailAutomationRule` / `run-email-drips` path; close episodes from a Payment `post('save')` hook so every `Payment.create` is covered.

**Tech Stack:** Next.js 15 App Router, Mongoose, Zod, Vitest, existing `sendEmail` / merge fields, Communications Automations UI, i18n JSON locales.

**Spec:** `docs/superpowers/specs/2026-08-21-dunning-arrears-design.md`

## Global Constraints

- Email engine only: no dashboard badges, no family Activity tab, no SMS, no new cron URL.
- Do not change `calculateFamilyBalance` math.
- Do not change `balance_gt_zero` or `event_within_30_days` recipient logic or the 24h whole-rule gate for those types.
- For `dunning_arrears`, skip the 24h `lastRunAt` gate; enforce per-family `maxAttempts` / `intervalDays`.
- `force` run bypasses only the 24h gate, never M/N, opt-out, invalid email, or missing template.
- Money unit for `minOwed` is the same number as `calculateFamilyBalance().balance`.
- Calendar-day math uses the organization timezone (`startOfDayInTimeZone` / `dateKeyInTimeZone` in `lib/date-utils.ts`).
- No new npm dependencies.
- Feature branch: `feat/dunning-arrears` from `main`; cherry-pick spec commit `6831f6c` if that file is missing on `main`.
- Tests: Vitest (`npx vitest run <file>`). Integration tests use `setupMongo` / `teardownMongo` from `lib/test/mongo-memory.ts`.

---

## File map

| Path | Responsibility |
| ---- | -------------- |
| `lib/dunning/types.ts` | Shared rule/episode TypeScript types |
| `lib/dunning/qualify.ts` | Pure qualify + calendar-day helpers |
| `lib/dunning/qualify.test.ts` | Unit tests for qualify / days |
| `lib/dunning/cycle-start.ts` | Current billing-cycle start (gregorian + hebrew) |
| `lib/dunning/cycle-start.test.ts` | Unit tests for cycle start |
| `lib/dunning/obligation.ts` | Load obligation start date (CycleCharge → cycle start → createdAt) |
| `lib/dunning/obligation.integration.test.ts` | Mongo tests for obligation start |
| `lib/dunning/episodes.ts` | Open / send-due / close / re-entry |
| `lib/dunning/episodes.integration.test.ts` | Mongo tests for episode lifecycle |
| `lib/dunning/execute.ts` | Dunning branch of a rule run (send + stats) |
| `lib/dunning/execute.integration.test.ts` | Execute + send-failure + 24h-gate skip |
| `lib/models/dunning-episode.ts` | `DunningEpisode` schema + indexes |
| `lib/models/email-automation-rule.ts` | Add `dunning_arrears` + threshold fields |
| `lib/models/index.ts` | Export `DunningEpisode` |
| `lib/models/payment.ts` | `post('save')` close-on-create |
| `lib/schemas/email-automation-rule.ts` | Zod discriminated union |
| `lib/schemas/email-automation-rule.test.ts` | Zod tests |
| `lib/route-logic/email-automation-rules/execute-rule.ts` | Branch to dunning execute; widen rule type |
| `lib/route-logic/email-automation-rules/resolve-recipients.ts` | Preview for dunning rules |
| `lib/route-logic/email-automation-rules/index.ts` | Persist dunning fields on create |
| `lib/route-logic/email-automation-rules/[id].ts` | Persist dunning fields on update |
| `lib/route-logic/email-automation-rules/[id]/preview.ts` | Pass full rule into resolve |
| `app/api/email-automation-rules/[id]/route.ts` | Export `PATCH = PUT` |
| `app/communications/_components/types.ts` | Widen `ruleType` + dunning fields |
| `app/communications/_components/AutomationsView.tsx` | Form fields + labels |
| `lib/i18n/messages/en-US.json` (and en-GB, es-MX, fr-FR, he-IL, yi.json) | New copy keys |

---

### Task 1: Qualify helpers (pure)

**Files:**

- Create: `lib/dunning/types.ts`
- Create: `lib/dunning/qualify.ts`
- Create: `lib/dunning/qualify.test.ts`

**Interfaces:**

- Consumes: `startOfDayInTimeZone` from `@/lib/date-utils`
- Produces:
  - `export type EmailAutomationRuleType = 'balance_gt_zero' | 'event_within_30_days' | 'dunning_arrears'`
  - `export type DunningClosedReason = 'payment' | 'max_attempts' | 'no_longer_qualifies'`
  - `export type DunningEpisodeStatus = 'open' | 'closed'`
  - `export function calendarDaysBetween(from: Date, to: Date, timezone: string | null | undefined): number`
  - `export function canReceiveDunningEmail(family: { email?: string | null; emailFormatInvalid?: boolean; communicationsOptOut?: boolean }): boolean`
  - `export function qualifiesForDunning(input: { balance: number; minOwed: number; obligationStart: Date; now: Date; timezone: string | null | undefined; daysSinceObligation: number }): boolean`

- [ ] **Step 1: Write the failing test**

Create `lib/dunning/qualify.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { calendarDaysBetween, canReceiveDunningEmail, qualifiesForDunning } from './qualify'

describe('calendarDaysBetween', () => {
  it('counts whole calendar days in the given timezone', () => {
    const from = new Date('2026-01-01T23:00:00.000Z')
    const to = new Date('2026-01-03T05:00:00.000Z')
    expect(calendarDaysBetween(from, to, 'UTC')).toBe(2)
  })

  it('returns 0 for the same calendar day', () => {
    const a = new Date('2026-06-15T01:00:00.000Z')
    const b = new Date('2026-06-15T23:00:00.000Z')
    expect(calendarDaysBetween(a, b, 'UTC')).toBe(0)
  })
})

describe('qualifiesForDunning', () => {
  const obligationStart = new Date('2026-01-01T00:00:00.000Z')
  const now = new Date('2026-02-01T12:00:00.000Z')

  it('returns false when balance is below minOwed', () => {
    expect(
      qualifiesForDunning({
        balance: 50,
        minOwed: 100,
        obligationStart,
        now,
        timezone: 'UTC',
        daysSinceObligation: 30,
      }),
    ).toBe(false)
  })

  it('returns false when obligation is too recent', () => {
    expect(
      qualifiesForDunning({
        balance: 200,
        minOwed: 100,
        obligationStart: new Date('2026-01-20T00:00:00.000Z'),
        now,
        timezone: 'UTC',
        daysSinceObligation: 30,
      }),
    ).toBe(false)
  })

  it('returns true when balance and age both meet thresholds', () => {
    expect(
      qualifiesForDunning({
        balance: 100,
        minOwed: 100,
        obligationStart,
        now,
        timezone: 'UTC',
        daysSinceObligation: 30,
      }),
    ).toBe(true)
  })
})

describe('canReceiveDunningEmail', () => {
  it('returns false when opted out, missing email, or format invalid', () => {
    expect(canReceiveDunningEmail({ email: 'a@b.com', communicationsOptOut: true })).toBe(false)
    expect(canReceiveDunningEmail({ email: '', emailFormatInvalid: false })).toBe(false)
    expect(canReceiveDunningEmail({ email: 'a@b.com', emailFormatInvalid: true })).toBe(false)
  })

  it('returns true for a valid email that is not opted out', () => {
    expect(canReceiveDunningEmail({ email: 'a@b.com' })).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/dunning/qualify.test.ts`

Expected: FAIL (cannot find module `./qualify`)

- [ ] **Step 3: Write minimal implementation**

Create `lib/dunning/types.ts`:

```ts
export type EmailAutomationRuleType =
  | 'balance_gt_zero'
  | 'event_within_30_days'
  | 'dunning_arrears'

export type DunningEpisodeStatus = 'open' | 'closed'

export type DunningClosedReason = 'payment' | 'max_attempts' | 'no_longer_qualifies'
```

Create `lib/dunning/qualify.ts`:

```ts
import { startOfDayInTimeZone } from '@/lib/date-utils'

const MS_PER_DAY = 86_400_000

export function calendarDaysBetween(
  from: Date,
  to: Date,
  timezone: string | null | undefined,
): number {
  const a = startOfDayInTimeZone(timezone, from).getTime()
  const b = startOfDayInTimeZone(timezone, to).getTime()
  return Math.floor((b - a) / MS_PER_DAY)
}

export function canReceiveDunningEmail(family: {
  email?: string | null
  emailFormatInvalid?: boolean
  communicationsOptOut?: boolean
}): boolean {
  if (family.communicationsOptOut) return false
  if (family.emailFormatInvalid) return false
  if (!family.email || family.email.trim() === '') return false
  return true
}

export function qualifiesForDunning(input: {
  balance: number
  minOwed: number
  obligationStart: Date
  now: Date
  timezone: string | null | undefined
  daysSinceObligation: number
}): boolean {
  if (!(input.balance >= input.minOwed)) return false
  const days = calendarDaysBetween(input.obligationStart, input.now, input.timezone)
  return days >= input.daysSinceObligation
}
```

- [ ] **Step 4: Run tests and make sure they pass**

Run: `npx vitest run lib/dunning/qualify.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/dunning/types.ts lib/dunning/qualify.ts lib/dunning/qualify.test.ts
git commit -m "feat(dunning): add qualify and calendar-day helpers"
```

---

### Task 2: Current billing-cycle start (pure)

**Files:**

- Create: `lib/dunning/cycle-start.ts`
- Create: `lib/dunning/cycle-start.test.ts`

**Interfaces:**

- Consumes: `HDate` from `@hebcal/hdate`; `getYearInTimeZone`, `startOfDayInTimeZone`, `zonedWallClockToUtc`, `daysInGregorianMonth` from `@/lib/date-utils`
- Produces:
  - `export type CycleStartInput = { calendar: 'gregorian' | 'hebrew'; cycleStartMonth: number; cycleStartDay: number; cycleStartHebrewMonth: number; cycleStartHebrewDay: number; timezone: string | null | undefined; now: Date }`
  - `export function currentBillingCycleStart(input: CycleStartInput): Date`

- [ ] **Step 1: Write the failing test**

Create `lib/dunning/cycle-start.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { currentBillingCycleStart } from './cycle-start'

describe('currentBillingCycleStart', () => {
  describe('when calendar is gregorian', () => {
    it('uses this year when now is on or after the cycle start', () => {
      const start = currentBillingCycleStart({
        calendar: 'gregorian',
        cycleStartMonth: 9,
        cycleStartDay: 1,
        cycleStartHebrewMonth: 7,
        cycleStartHebrewDay: 1,
        timezone: 'UTC',
        now: new Date('2026-10-01T12:00:00.000Z'),
      })
      expect(start.toISOString().startsWith('2026-09-01')).toBe(true)
    })

    it('uses previous year when now is before this year cycle start', () => {
      const start = currentBillingCycleStart({
        calendar: 'gregorian',
        cycleStartMonth: 9,
        cycleStartDay: 1,
        cycleStartHebrewMonth: 7,
        cycleStartHebrewDay: 1,
        timezone: 'UTC',
        now: new Date('2026-03-01T12:00:00.000Z'),
      })
      expect(start.toISOString().startsWith('2025-09-01')).toBe(true)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/dunning/cycle-start.test.ts`

Expected: FAIL (cannot find module `./cycle-start`)

- [ ] **Step 3: Write minimal implementation**

Create `lib/dunning/cycle-start.ts`:

```ts
import { HDate } from '@hebcal/hdate'
import {
  daysInGregorianMonth,
  getYearInTimeZone,
  startOfDayInTimeZone,
  zonedWallClockToUtc,
} from '@/lib/date-utils'

export type CycleStartInput = {
  calendar: 'gregorian' | 'hebrew'
  cycleStartMonth: number
  cycleStartDay: number
  cycleStartHebrewMonth: number
  cycleStartHebrewDay: number
  timezone: string | null | undefined
  now: Date
}

export function currentBillingCycleStart(input: CycleStartInput): Date {
  if (input.calendar === 'hebrew') {
    const today = new HDate(startOfDayInTimeZone(input.timezone, input.now))
    const month = input.cycleStartHebrewMonth
    const day = input.cycleStartHebrewDay
    let year = today.getFullYear()
    let start = new HDate(day, month, year)
    if (today.abs() < start.abs()) {
      start = new HDate(day, month, year - 1)
    }
    return startOfDayInTimeZone(input.timezone, start.greg())
  }

  const yearNow = getYearInTimeZone(input.timezone, input.now)
  const month = input.cycleStartMonth
  const lastDay = daysInGregorianMonth(yearNow, month)
  const day = Math.min(input.cycleStartDay, lastDay)
  const thisYear = zonedWallClockToUtc(yearNow, month, day, 0, 0, 0, 0, input.timezone)
  const nowStart = startOfDayInTimeZone(input.timezone, input.now)
  if (nowStart.getTime() >= thisYear.getTime()) return thisYear
  const prevLast = daysInGregorianMonth(yearNow - 1, month)
  const prevDay = Math.min(input.cycleStartDay, prevLast)
  return zonedWallClockToUtc(yearNow - 1, month, prevDay, 0, 0, 0, 0, input.timezone)
}
```

If `HDate` constructor argument order fails the hebrew tests you add, swap to the order used in `lib/jobs.ts` (`new HDate(startOfDayInTimeZone(...))`) and construct via `HDate` APIs that already compile in this repo. Add one hebrew assertion once the constructor is confirmed.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `npx vitest run lib/dunning/cycle-start.test.ts lib/dunning/qualify.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/dunning/cycle-start.ts lib/dunning/cycle-start.test.ts
git commit -m "feat(dunning): compute current billing cycle start"
```

---

### Task 3: Zod schema for dunning rules

**Files:**

- Modify: `lib/schemas/email-automation-rule.ts`
- Create: `lib/schemas/email-automation-rule.test.ts`

**Interfaces:**

- Consumes: `z`, `objectId` from `./common`
- Produces: `emailAutomationRuleType` includes `'dunning_arrears'`; `emailAutomationRuleBody` requires `minOwed` (number `> 0`) when `ruleType === 'dunning_arrears'`; optional `daysSinceObligation` (1–3650), `maxAttempts` (1–12), `intervalDays` (1–90); `emailAutomationRuleUpdateBody` allows partial updates and, when `ruleType` is set to `dunning_arrears`, requires `minOwed`

- [ ] **Step 1: Write the failing test**

Create `lib/schemas/email-automation-rule.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  emailAutomationRuleBody,
  emailAutomationRuleUpdateBody,
} from './email-automation-rule'

const templateId = '507f1f77bcf86cd799439011'

describe('emailAutomationRuleBody', () => {
  it('rejects dunning_arrears without minOwed', () => {
    const parsed = emailAutomationRuleBody.safeParse({
      name: 'Overdue',
      templateId,
      ruleType: 'dunning_arrears',
    })
    expect(parsed.success).toBe(false)
  })

  it('accepts dunning_arrears with minOwed and fills defaults', () => {
    const parsed = emailAutomationRuleBody.parse({
      name: 'Overdue',
      templateId,
      ruleType: 'dunning_arrears',
      minOwed: 100,
    })
    expect(parsed.ruleType).toBe('dunning_arrears')
    if (parsed.ruleType === 'dunning_arrears') {
      expect(parsed.minOwed).toBe(100)
      expect(parsed.daysSinceObligation).toBe(30)
      expect(parsed.maxAttempts).toBe(3)
      expect(parsed.intervalDays).toBe(7)
    }
  })

  it('still accepts balance_gt_zero without dunning fields', () => {
    const parsed = emailAutomationRuleBody.parse({
      name: 'Balance',
      templateId,
      ruleType: 'balance_gt_zero',
    })
    expect(parsed.ruleType).toBe('balance_gt_zero')
  })
})

describe('emailAutomationRuleUpdateBody', () => {
  it('rejects empty patch', () => {
    expect(emailAutomationRuleUpdateBody.safeParse({}).success).toBe(false)
  })

  it('allows enabled-only patch', () => {
    expect(emailAutomationRuleUpdateBody.parse({ enabled: true })).toEqual({ enabled: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/schemas/email-automation-rule.test.ts`

Expected: FAIL (`dunning_arrears` not in enum)

- [ ] **Step 3: Write minimal implementation**

Replace `lib/schemas/email-automation-rule.ts` with:

```ts
import { z } from 'zod'
import { objectId } from './common'

export const emailAutomationRuleType = z.enum([
  'balance_gt_zero',
  'event_within_30_days',
  'dunning_arrears',
])

const baseFields = {
  name: z.string().min(1).max(200).trim(),
  enabled: z.boolean().optional(),
  templateId: objectId,
}

const balanceRule = z.object({
  ...baseFields,
  ruleType: z.literal('balance_gt_zero'),
})

const eventRule = z.object({
  ...baseFields,
  ruleType: z.literal('event_within_30_days'),
})

const dunningRule = z.object({
  ...baseFields,
  ruleType: z.literal('dunning_arrears'),
  minOwed: z.number().positive(),
  daysSinceObligation: z.number().int().min(1).max(3650).optional().default(30),
  maxAttempts: z.number().int().min(1).max(12).optional().default(3),
  intervalDays: z.number().int().min(1).max(90).optional().default(7),
})

export const emailAutomationRuleBody = z.discriminatedUnion('ruleType', [
  balanceRule,
  eventRule,
  dunningRule,
])

export const emailAutomationRuleUpdateBody = z
  .object({
    name: z.string().min(1).max(200).trim().optional(),
    enabled: z.boolean().optional(),
    templateId: objectId.optional(),
    ruleType: emailAutomationRuleType.optional(),
    minOwed: z.number().positive().optional(),
    daysSinceObligation: z.number().int().min(1).max(3650).optional(),
    maxAttempts: z.number().int().min(1).max(12).optional(),
    intervalDays: z.number().int().min(1).max(90).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' })
  .refine((v) => (v.ruleType === 'dunning_arrears' ? v.minOwed != null : true), {
    message: 'minOwed is required when ruleType is dunning_arrears',
    path: ['minOwed'],
  })
```

- [ ] **Step 4: Run tests and make sure they pass**

Run: `npx vitest run lib/schemas/email-automation-rule.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/schemas/email-automation-rule.ts lib/schemas/email-automation-rule.test.ts
git commit -m "feat(dunning): validate dunning_arrears automation payloads"
```

---

### Task 4: Models — rule fields + DunningEpisode

**Files:**

- Modify: `lib/models/email-automation-rule.ts`
- Create: `lib/models/dunning-episode.ts`
- Modify: `lib/models/index.ts` — add `export { DunningEpisode } from './dunning-episode'` after the `EmailAutomationRule` export

**Interfaces:**

- Produces: Mongoose model `DunningEpisode` with fields `organizationId`, `familyId`, `ruleId`, `status` (`open` | `closed`), `sendCount` (default 0), `lastSentAt` (Date | null), `closedAt` (Date | null), `closedReason` (`payment` | `max_attempts` | `no_longer_qualifies` | null)
- Unique partial index: `{ organizationId: 1, familyId: 1, ruleId: 1 }` with `partialFilterExpression: { status: 'open' }`
- Extra indexes: `{ organizationId: 1, familyId: 1, status: 1 }` and `{ organizationId: 1, ruleId: 1, status: 1 }`
- `EmailAutomationRule.ruleType` enum includes `dunning_arrears`; fields `minOwed`, `daysSinceObligation`, `maxAttempts`, `intervalDays` (Number, optional)

- [ ] **Step 1: Write the failing integration test**

Create `lib/dunning/episodes.integration.test.ts` (first cases only — unique open episode). Keep later episode-service cases for Task 5 in the same file.

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { Types } from 'mongoose'
import { setupMongo, teardownMongo } from '@/lib/test/mongo-memory'

describe('DunningEpisode model', () => {
  beforeAll(async () => {
    await setupMongo()
  })
  afterAll(async () => {
    await teardownMongo()
  })
  afterEach(async () => {
    const { DunningEpisode } = await import('@/lib/models')
    await DunningEpisode.deleteMany({})
  })

  it('rejects a second open episode for the same org/family/rule', async () => {
    const { DunningEpisode } = await import('@/lib/models')
    const organizationId = new Types.ObjectId()
    const familyId = new Types.ObjectId()
    const ruleId = new Types.ObjectId()
    await DunningEpisode.create({ organizationId, familyId, ruleId, status: 'open' })
    await expect(
      DunningEpisode.create({ organizationId, familyId, ruleId, status: 'open' }),
    ).rejects.toMatchObject({ code: 11000 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/dunning/episodes.integration.test.ts`

Expected: FAIL (`DunningEpisode` export missing)

- [ ] **Step 3: Write minimal implementation**

`lib/models/dunning-episode.ts`:

```ts
import mongoose, { Schema } from 'mongoose'

const DunningEpisodeSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
    ruleId: { type: Schema.Types.ObjectId, ref: 'EmailAutomationRule', required: true },
    status: { type: String, enum: ['open', 'closed'], required: true, default: 'open' },
    sendCount: { type: Number, default: 0, min: 0 },
    lastSentAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    closedReason: {
      type: String,
      enum: ['payment', 'max_attempts', 'no_longer_qualifies'],
      default: null,
    },
  },
  { timestamps: true },
)

DunningEpisodeSchema.index(
  { organizationId: 1, familyId: 1, ruleId: 1 },
  { unique: true, partialFilterExpression: { status: 'open' } },
)
DunningEpisodeSchema.index({ organizationId: 1, familyId: 1, status: 1 })
DunningEpisodeSchema.index({ organizationId: 1, ruleId: 1, status: 1 })

export const DunningEpisode =
  mongoose.models.DunningEpisode || mongoose.model('DunningEpisode', DunningEpisodeSchema)
```

Update `lib/models/email-automation-rule.ts` `ruleType.enum` to `['balance_gt_zero', 'event_within_30_days', 'dunning_arrears']` and add:

```ts
minOwed: { type: Number, min: 0 },
daysSinceObligation: { type: Number, min: 1, max: 3650 },
maxAttempts: { type: Number, min: 1, max: 12 },
intervalDays: { type: Number, min: 1, max: 90 },
```

Export from `lib/models/index.ts`.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `npx vitest run lib/dunning/episodes.integration.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/models/dunning-episode.ts lib/models/email-automation-rule.ts lib/models/index.ts lib/dunning/episodes.integration.test.ts
git commit -m "feat(dunning): add DunningEpisode model and rule fields"
```

---

### Task 5: Episode service

**Files:**

- Create: `lib/dunning/episodes.ts`
- Modify: `lib/dunning/episodes.integration.test.ts`

**Interfaces:**

- Consumes: `DunningEpisode` from `@/lib/models`; `calendarDaysBetween` from `./qualify`; `DunningClosedReason` from `./types`
- Produces:
  - `export type DunningRuleCadence = { _id: { toString(): string }; maxAttempts: number; intervalDays: number }`
  - `export async function closeDunningEpisodesForPayment(args: { organizationId: string; familyId: string }): Promise<number>`
  - `export async function latestEpisode(args: { organizationId: string; familyId: string; ruleId: string }): Promise<{ status: 'open' | 'closed'; sendCount: number; lastSentAt: Date | null; closedAt: Date | null } | null>`
  - `export async function planDunningAction(args: { organizationId: string; familyId: string; rule: DunningRuleCadence; qualifies: boolean; now: Date; timezone: string | null | undefined }): Promise<{ action: 'skip' } | { action: 'close'; reason: DunningClosedReason } | { action: 'send'; episodeId: string }>`
  - `export async function recordSuccessfulDunningSend(args: { episodeId: string; now: Date; maxAttempts: number }): Promise<void>`

Behavior for `planDunningAction` (must match spec):

- qualifies false + open episode → `{ action: 'close', reason: 'no_longer_qualifies' }` and persist closed
- qualifies false + no open → `{ action: 'skip' }`
- qualifies true + open + `sendCount >= maxAttempts` → close `max_attempts` (should already be closed after send; treat as skip/close)
- qualifies true + open + `sendCount < maxAttempts` + (`lastSentAt` null or days since `lastSentAt` ≥ `intervalDays`) → `{ action: 'send', episodeId }`
- qualifies true + open + days since last send < N → `{ action: 'skip' }`
- qualifies true + no open + latest closed has `lastSentAt` (or `closedAt`) and days since that instant < N → `{ action: 'skip' }`
- qualifies true + no open + quiet period elapsed (or never emailed) → create open episode, `{ action: 'send', episodeId }`

`recordSuccessfulDunningSend`: increment `sendCount`, set `lastSentAt`. If new `sendCount >= maxAttempts`, set `status: 'closed'`, `closedReason: 'max_attempts'`, `closedAt: now`.

`closeDunningEpisodesForPayment`: `updateMany` open episodes for that org+family to closed / `payment` / `closedAt: now`. Return `modifiedCount`.

- [ ] **Step 1: Write failing tests** (append to `lib/dunning/episodes.integration.test.ts`)

```ts
describe('planDunningAction', () => {
  it('opens and sends on first qualify', async () => {
    const { planDunningAction, latestEpisode } = await import('./episodes')
    const organizationId = new Types.ObjectId().toString()
    const familyId = new Types.ObjectId().toString()
    const rule = { _id: new Types.ObjectId(), maxAttempts: 3, intervalDays: 7 }
    const result = await planDunningAction({
      organizationId,
      familyId,
      rule,
      qualifies: true,
      now: new Date('2026-08-01T12:00:00.000Z'),
      timezone: 'UTC',
    })
    expect(result.action).toBe('send')
    const ep = await latestEpisode({ organizationId, familyId, ruleId: String(rule._id) })
    expect(ep?.status).toBe('open')
    expect(ep?.sendCount).toBe(0)
  })

  it('skips when last send was fewer than intervalDays ago', async () => {
    const { planDunningAction, recordSuccessfulDunningSend } = await import('./episodes')
    const organizationId = new Types.ObjectId().toString()
    const familyId = new Types.ObjectId().toString()
    const rule = { _id: new Types.ObjectId(), maxAttempts: 3, intervalDays: 7 }
    const first = await planDunningAction({
      organizationId,
      familyId,
      rule,
      qualifies: true,
      now: new Date('2026-08-01T12:00:00.000Z'),
      timezone: 'UTC',
    })
    if (first.action !== 'send') throw new Error('expected send')
    await recordSuccessfulDunningSend({
      episodeId: first.episodeId,
      now: new Date('2026-08-01T12:00:00.000Z'),
      maxAttempts: 3,
    })
    const second = await planDunningAction({
      organizationId,
      familyId,
      rule,
      qualifies: true,
      now: new Date('2026-08-03T12:00:00.000Z'),
      timezone: 'UTC',
    })
    expect(second.action).toBe('skip')
  })

  it('closes on payment and does not send again until intervalDays pass', async () => {
    const {
      planDunningAction,
      recordSuccessfulDunningSend,
      closeDunningEpisodesForPayment,
    } = await import('./episodes')
    const organizationId = new Types.ObjectId().toString()
    const familyId = new Types.ObjectId().toString()
    const rule = { _id: new Types.ObjectId(), maxAttempts: 3, intervalDays: 7 }
    const first = await planDunningAction({
      organizationId,
      familyId,
      rule,
      qualifies: true,
      now: new Date('2026-08-01T12:00:00.000Z'),
      timezone: 'UTC',
    })
    if (first.action !== 'send') throw new Error('expected send')
    await recordSuccessfulDunningSend({
      episodeId: first.episodeId,
      now: new Date('2026-08-01T12:00:00.000Z'),
      maxAttempts: 3,
    })
    const closed = await closeDunningEpisodesForPayment({ organizationId, familyId })
    expect(closed).toBe(1)
    const tooSoon = await planDunningAction({
      organizationId,
      familyId,
      rule,
      qualifies: true,
      now: new Date('2026-08-03T12:00:00.000Z'),
      timezone: 'UTC',
    })
    expect(tooSoon.action).toBe('skip')
    const later = await planDunningAction({
      organizationId,
      familyId,
      rule,
      qualifies: true,
      now: new Date('2026-08-09T12:00:00.000Z'),
      timezone: 'UTC',
    })
    expect(later.action).toBe('send')
  })
})
```

Also test: send failure is **not** in this file — that is Task 7 (`recordSuccessfulDunningSend` not called). Test `planDunningAction` close `no_longer_qualifies` when `qualifies: false` with an open episode.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/dunning/episodes.integration.test.ts`

Expected: FAIL (cannot find `./episodes`)

- [ ] **Step 3: Implement `lib/dunning/episodes.ts`**

Implement the functions listed in Interfaces. Use `DunningEpisode.findOne({ organizationId, familyId, ruleId, status: 'open' })`. For latest episode including closed, `findOne({ organizationId, familyId, ruleId }).sort({ createdAt: -1, _id: -1 })`. Create with `status: 'open', sendCount: 0`. On unique index conflict (11000), re-fetch the open episode and continue.

- [ ] **Step 4: Run tests and make sure they pass**

Run: `npx vitest run lib/dunning/episodes.integration.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/dunning/episodes.ts lib/dunning/episodes.integration.test.ts
git commit -m "feat(dunning): episode open, cadence, payment close, re-entry"
```

---

### Task 6: Obligation start date

**Files:**

- Create: `lib/dunning/obligation.ts`
- Create: `lib/dunning/obligation.integration.test.ts`

**Interfaces:**

- Consumes: `CycleCharge`, `CycleConfig`, `Organization`, `Family` from `@/lib/models`; `currentBillingCycleStart` from `./cycle-start`
- Produces: `export async function obligationStartDate(args: { organizationId: string; familyId: string; familyCreatedAt: Date; now?: Date }): Promise<Date>`

Logic:

1. `CycleCharge.find({ organizationId, familyId, deletedAt: null }).sort({ chargeDate: 1 }).limit(1)` — if found, return `chargeDate`
2. Else load active `CycleConfig` for org + org `timezone`; if config exists, return `currentBillingCycleStart({ calendar: config.cycleCalendar === 'hebrew' ? 'hebrew' : 'gregorian', cycleStartMonth: config.cycleStartMonth ?? 1, cycleStartDay: config.cycleStartDay ?? 1, cycleStartHebrewMonth: config.cycleStartHebrewMonth ?? 7, cycleStartHebrewDay: config.cycleStartHebrewDay ?? 1, timezone: org.timezone, now: args.now ?? new Date() })`
3. Else return `familyCreatedAt`

- [ ] **Step 1: Write failing tests** in `lib/dunning/obligation.integration.test.ts` using `setupMongo`. Seed `Organization`, `Family`, optional `CycleCharge` / `CycleConfig`. Assert earliest `chargeDate` wins; without charges, September 1 cycle in UTC in October returns that year’s Sept 1; without config, `family.createdAt`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/dunning/obligation.integration.test.ts`

Expected: FAIL (module missing)

- [ ] **Step 3: Implement `obligationStartDate`**

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/dunning/obligation.integration.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/dunning/obligation.ts lib/dunning/obligation.integration.test.ts
git commit -m "feat(dunning): resolve obligation start from charges or cycle"
```

---

### Task 7: Execute dunning rule (sends + 24h gate)

**Files:**

- Create: `lib/dunning/execute.ts`
- Create: `lib/dunning/execute.integration.test.ts`
- Modify: `lib/route-logic/email-automation-rules/execute-rule.ts`

**Interfaces:**

- Consumes: `familyBatches` from `@/lib/org-pagination`; `calculateFamilyBalance` from `@/lib/calculations`; `sendEmail`, `applyMergeFields`, `loadMergeFieldContext`, `delayBetweenSendsMs`, `sleep` from `@/lib/mail`; `escapeHtml` from `@/lib/html-escape`; `EmailTemplate`, `Organization` from `@/lib/models`; `audit` from `@/lib/audit`; `qualifiesForDunning`, `canReceiveDunningEmail` from `./qualify`; `obligationStartDate` from `./obligation`; `planDunningAction`, `recordSuccessfulDunningSend` from `./episodes`
- Produces:
  - `export type DunningExecuteRule = { _id: Types.ObjectId; templateId: Types.ObjectId; minOwed: number; daysSinceObligation: number; maxAttempts: number; intervalDays: number }`
  - `export async function executeDunningArrearsRule(organizationId: string, rule: DunningExecuteRule, template: { subject: string; html: string; text?: string }): Promise<{ sent: number; failed: number; skipped: number }>`

`executeEmailAutomationRule` changes:

- Widen `rule.ruleType` to include `'dunning_arrears'`
- Widen rule with optional `minOwed`, `daysSinceObligation`, `maxAttempts`, `intervalDays`
- Apply 24h `lastRunAt` skip **only when** `rule.ruleType !== 'dunning_arrears'`
- After template load, if `dunning_arrears`: if `minOwed` missing or `<= 0`, persist stats with error `'minOwed missing'` and return skipped; else call `executeDunningArrearsRule` then `persistLastRunStats`; **do not** call `listAutomationRecipients` for this type
- Existing recipient loop unchanged for the other two types

`executeDunningArrearsRule`:

- Load org timezone
- Iterate `familyBatches(organizationId, { select: '_id name email emailFormatInvalid communicationsOptOut createdAt' })`
- For each family: if `!canReceiveDunningEmail` → skipped++; continue
- `balance = (await calculateFamilyBalance(id, organizationId)).balance`
- `obligationStart = await obligationStartDate({ organizationId, familyId: id, familyCreatedAt: family.createdAt })`
- `qualifies = qualifiesForDunning({ balance, minOwed: rule.minOwed, obligationStart, now: new Date(), timezone, daysSinceObligation: rule.daysSinceObligation })`
- `planned = await planDunningAction({ organizationId, familyId: id, rule: { _id: rule._id, maxAttempts: rule.maxAttempts, intervalDays: rule.intervalDays }, qualifies, now: new Date(), timezone })`
- if skip → skipped++
- if close → skipped++ (already persisted)
- if send: pace with `delayBetweenSendsMs`; merge fields + `sendEmail` with `kind: 'custom'` same as `execute-rule.ts`; **only if** `result.ok` call `recordSuccessfulDunningSend` and `audit({ organizationId, action: 'email_automation_rule.dunning_send', resourceType: 'Family', resourceId: family._id, metadata: { ruleId: String(rule._id) } })` then sent++; else failed++ (do **not** record send)

Cron job `lib/route-logic/email-automations/run-drips.ts` needs no URL change; it already passes the lean rule document into `executeEmailAutomationRule`.

- [ ] **Step 1: Write failing tests** in `lib/dunning/execute.integration.test.ts`

Seed org, family with email, payment plan with `yearlyPrice` so balance ≥ minOwed, `CycleCharge` with `chargeDate` 40 days ago, template, dunning rule. `vi.spyOn` `sendEmail` from `@/lib/mail` to resolve `{ ok: true }`. Call `executeEmailAutomationRule`. Assert spy called once and episode `sendCount === 1`.

Second test: `lastRunAt` 1 hour ago, type `dunning_arrears`, still sends (24h gate off).

Third test: type `balance_gt_zero`, `lastRunAt` 1 hour ago, returns `{ skipped: true, reason: 'Ran within the last 24 hours' }` without sending.

Fourth test: spy returns `{ ok: false }`; `sendCount` stays 0.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/dunning/execute.integration.test.ts`

Expected: FAIL (executeDunning missing and/or 24h gate still applies)

- [ ] **Step 3: Implement execute module and branch in `execute-rule.ts`**

Default cadence if fields missing at execute time: `daysSinceObligation ?? 30`, `maxAttempts ?? 3`, `intervalDays ?? 7`. Still require `minOwed > 0`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/dunning/execute.integration.test.ts lib/dunning/episodes.integration.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/dunning/execute.ts lib/dunning/execute.integration.test.ts lib/route-logic/email-automation-rules/execute-rule.ts
git commit -m "feat(dunning): execute arrears rules without 24h family-wide gate"
```

---

### Task 8: Close episodes on Payment.create

**Files:**

- Modify: `lib/models/payment.ts`
- Modify: `lib/dunning/execute.integration.test.ts` (or add cases to `lib/dunning/episodes.integration.test.ts`)

**Interfaces:**

- Consumes: `closeDunningEpisodesForPayment` from `@/lib/dunning/episodes` via **dynamic import** inside the hook (avoid circular `models` ↔ `dunning` load)
- Produces: Payment schema `post('save')` — if `doc.isNew` and `doc.organizationId` and `doc.familyId` and not soft-deleted, call `closeDunningEpisodesForPayment`. Swallow errors after `logError` from `@/lib/log` (payment must still persist).

Do **not** hook `insertMany`. Product `Payment.create` paths all use `create`/`save`.

- [ ] **Step 1: Write failing test**

In `lib/dunning/episodes.integration.test.ts`: open an episode, `Payment.create` a row for that family/org (minimal required Payment fields from `lib/models/payment.ts`), assert episode `status === 'closed'` and `closedReason === 'payment'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/dunning/episodes.integration.test.ts`

Expected: FAIL (episode still open)

- [ ] **Step 3: Add post-save hook** after `PaymentSchema.plugin(softDeletePlugin)` and **before** `mongoose.model(...)`:

```ts
PaymentSchema.post('save', function (doc) {
  if (!doc.isNew) return
  const organizationId = String(doc.organizationId)
  const familyId = String(doc.familyId)
  void import('@/lib/dunning/episodes')
    .then(({ closeDunningEpisodesForPayment }) =>
      closeDunningEpisodesForPayment({ organizationId, familyId }),
    )
    .catch(async (err) => {
      const { logError } = await import('@/lib/log')
      logError(err, { module: 'dunning.payment-hook', organizationId, familyId })
    })
})
```

Mongoose `isNew` is false in some `post('save')` versions after save. If the test fails because `isNew` is false, use `this.$isNew` in a `post('save')` **document** middleware registered as `PaymentSchema.post('save', function () { ... })` checking `this.wasNew` set from `pre('save')`:

```ts
PaymentSchema.pre('save', function () {
  ;(this as { $wasNew?: boolean }).$wasNew = this.isNew
})
PaymentSchema.post('save', function () {
  if (!(this as { $wasNew?: boolean }).$wasNew) return
  // closeDunningEpisodesForPayment ...
})
```

Use the pre/post pair if the first hook does not fire as new.

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/dunning/episodes.integration.test.ts`

Expected: PASS. Await a short `setTimeout(0)` or poll episode if the hook is async fire-and-forget.

- [ ] **Step 5: Commit**

```bash
git add lib/models/payment.ts lib/dunning/episodes.integration.test.ts
git commit -m "feat(dunning): close open episodes when a payment is saved"
```

---

### Task 9: Persist dunning fields on create/update + preview + PATCH

**Files:**

- Modify: `lib/route-logic/email-automation-rules/index.ts` — on create, if `body.ruleType === 'dunning_arrears'`, pass `minOwed`, `daysSinceObligation`, `maxAttempts`, `intervalDays` into `EmailAutomationRule.create`
- Modify: `lib/route-logic/email-automation-rules/[id].ts` — `$set` already spreads `body`; no extra mapping if zod keeps those keys
- Modify: `lib/route-logic/email-automation-rules/resolve-recipients.ts`
- Modify: `lib/route-logic/email-automation-rules/[id]/preview.ts`
- Modify: `app/api/email-automation-rules/[id]/route.ts` — add `export const PATCH = PUT` (UI already PATCHes `{ enabled }`)

**Interfaces:**

- Change `resolveAutomationRecipients` and `listAutomationRecipients` first argument after org to accept either the old `ruleType` string **or** a rule object. Implement:

```ts
export type AutomationRuleRef =
  | EmailAutomationRuleType
  | {
      ruleType: EmailAutomationRuleType
      minOwed?: number
      daysSinceObligation?: number
      maxAttempts?: number
      intervalDays?: number
      _id?: { toString(): string }
    }

function ruleTypeOf(rule: AutomationRuleRef): EmailAutomationRuleType {
  return typeof rule === 'string' ? rule : rule.ruleType
}
```

When `ruleTypeOf === 'dunning_arrears'`, preview candidates: page families with `familyBatches`, apply `canReceiveDunningEmail`, `calculateFamilyBalance`, `obligationStartDate`, `qualifiesForDunning` with `minOwed` / `daysSinceObligation` from the object (defaults 30 if missing). Do **not** require an open episode for preview (preview = would qualify now, not “due to send today”). Sample first 10. Count skipped noEmail / optOut like existing preview.

Keep `listAutomationRecipients` for non-dunning types exactly as today. Dunning execute must **not** use this list (Task 7 already bypasses it).

`preview.ts`: pass `rule` (lean doc) instead of `rule.ruleType`.

- [ ] **Step 1: Write failing tests**

Extend `lib/schemas/email-automation-rule.test.ts` if needed. Add `lib/dunning/preview.integration.test.ts`: create qualifying family + dunning rule; call `resolveAutomationRecipients(orgId, rule)`; `recipientCount === 1`. Family below minOwed → 0.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/dunning/preview.integration.test.ts`

Expected: FAIL (preview ignores dunning fields)

- [ ] **Step 3: Implement resolve + create mapping + PATCH export**

Create mapping in `index.ts`:

```ts
const doc: Record<string, unknown> = {
  organizationId: ctx!.organizationId,
  name: body.name,
  enabled: body.enabled ?? false,
  templateId: body.templateId,
  ruleType: body.ruleType,
}
if (body.ruleType === 'dunning_arrears') {
  doc.minOwed = body.minOwed
  doc.daysSinceObligation = body.daysSinceObligation
  doc.maxAttempts = body.maxAttempts
  doc.intervalDays = body.intervalDays
}
const rule = await EmailAutomationRule.create(doc)
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/dunning/preview.integration.test.ts lib/schemas/email-automation-rule.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/route-logic/email-automation-rules/index.ts lib/route-logic/email-automation-rules/[id].ts lib/route-logic/email-automation-rules/resolve-recipients.ts lib/route-logic/email-automation-rules/[id]/preview.ts app/api/email-automation-rules/[id]/route.ts lib/dunning/preview.integration.test.ts
git commit -m "feat(dunning): persist rule fields and preview qualifying families"
```

---

### Task 10: Automations UI + i18n

**Files:**

- Modify: `app/communications/_components/types.ts`
- Modify: `app/communications/_components/AutomationsView.tsx`
- Modify: `lib/i18n/messages/en-US.json`, `en-GB.json`, `es-MX.json`, `fr-FR.json`, `he-IL.json`, `yi.json`

**Interfaces:**

- `EmailAutomationRuleRow.ruleType` includes `'dunning_arrears'`
- Optional on row: `minOwed?: number; daysSinceObligation?: number; maxAttempts?: number; intervalDays?: number`
- `DraftRule` adds those four fields; `EMPTY_DRAFT` uses `ruleType: 'balance_gt_zero'`, `minOwed: ''` as string for the input or `minOwed: 0` unused until type is dunning

i18n keys (add identical keys to every locale file; non-English may use the English string for this slice):

- `communications.automations.ruleType.dunning` → `Overdue balance (dunning)`
- `communications.automations.field.minOwed` → `Minimum amount owed`
- `communications.automations.field.daysSinceObligation` → `Days since obligation`
- `communications.automations.field.maxAttempts` → `Max emails per episode`
- `communications.automations.field.intervalDays` → `Days between emails`

UI:

- Add `<option value="dunning_arrears">` in the create Select
- When `draft.ruleType === 'dunning_arrears'`, show four inputs (number). `minOwed` required before create (`missingFields` toast if empty)
- POST body includes dunning fields only for that type
- `ruleTypeLabel` handles `dunning_arrears`
- List subtitle may show `minOwed` / days when type is dunning (optional one line)

No dashboard, no family tab.

- [ ] **Step 1: Write failing test** if a smoke test exists for AutomationsView; otherwise skip to implementation. Prefer `app/communications/_components/AutomationsView.test.tsx` only if the folder already tests views with Testing Library. If no view tests exist, do not invent a heavy RTL harness — this task is UI + keys. Verify TypeScript by running `npx tsc --noEmit` if that is the project check; else rely on vitest files from earlier tasks still passing.

If you add a small test, assert `ruleTypeLabel` logic by extracting:

```ts
export function automationRuleTypeLabel(
  ruleType: EmailAutomationRuleRow['ruleType'],
  t: (key: MessageKey, fallback?: string) => string,
): string
```

in `app/communications/_components/automation-rule-type-label.ts` and unit-test that `dunning_arrears` maps to the dunning key. That keeps TDD without mounting the full page.

- [ ] **Step 2: Run the label test (if added) expecting fail, then implement**

- [ ] **Step 3: Implement UI + JSON keys in all six locale files** (same key paths; `MessageKey` is `keyof typeof enUS`)

- [ ] **Step 4: Run** `npx vitest run lib/dunning lib/schemas/email-automation-rule.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/communications/_components/types.ts app/communications/_components/AutomationsView.tsx app/communications/_components/automation-rule-type-label.ts lib/i18n/messages/*.json
git commit -m "feat(dunning): expose arrears rule type in Automations UI"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
| ---------------- | ---- |
| `dunning_arrears` on `EmailAutomationRule` | 3, 4, 9 |
| `minOwed`, days, M, N + defaults 30/3/7 | 3, 7, 9 |
| `DunningEpisode` unique open | 4, 5 |
| Qualify: balance ≥ min + obligation age | 1, 6, 7 |
| Obligation: CycleCharge → cycle start → createdAt | 6 |
| Org timezone day counts | 1, 2 |
| M per episode, N spacing, re-entry after N | 5 |
| Any Payment closes | 5, 8 |
| Failed send does not increment | 7 |
| Skip 24h gate for dunning only | 7 |
| Same drip cron | 7 (no new route) |
| Preview | 9 |
| Opt-out / invalid email | 1, 7 |
| Audit on successful send | 7 |
| Automations UI only | 10 |
| No dashboard / SMS / extra cron | not scheduled |

No remaining spec items without a task.
