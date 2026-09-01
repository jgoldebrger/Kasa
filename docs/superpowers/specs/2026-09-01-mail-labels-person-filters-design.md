# Mail Labels — Person-Level Audience Filters

**Date:** 2026-09-01
**Status:** Approved design, ready for implementation planning

## Problem

The Mail Labels panel (Avery 5160 printing) can only address a whole household. Staff
need to run targeted physical mailings — ladies only, bucherim only, kids from age 10 up
— and today there is no way to do that anywhere in the app.

Person-level audience selection does not exist in KASA. Every recipient surface
(communications compose, email automations, mail labels) selects **family IDs**. Person
data lives in `FamilyMember` but is never used for audience selection.

## Scope

In scope: the Mail Labels panel only (`app/components/settings/MailLabelsPanel.tsx`,
Settings → Labels tab).

Out of scope: email communications, SMS, family tags, letter generation. Those keep
their current family-level audience behavior.

## Definitions

Agreed with the user:

- A **bochur** is a male child until his wedding date. There is no age floor.
- A **girl** (unmarried daughter) follows the same rule: female child until her wedding date.
- **Kids** are not a fixed age bucket. The user needs to type an age, e.g. "10 and up".

Because the definitions are composable rather than fixed, the UI exposes composable
filters plus one-click presets that pre-fill them.

## Design

### 1. Recipient types

| Type      | Source                                     | Label name                           |
| --------- | ------------------------------------------ | ------------------------------------ |
| Household | `Family.name`                              | family name verbatim                 |
| Husband   | `Family.husbandFirstName`                  | `"{husbandFirstName} {Family.name}"` |
| Wife      | `Family.wifeFirstName`                     | `"{wifeFirstName} {Family.name}"`    |
| Sons      | `FamilyMember` where `gender === 'male'`   | `"{firstName} {lastName}"`           |
| Daughters | `FamilyMember` where `gender === 'female'` | `"{firstName} {lastName}"`           |

**Household is checked by default.** With only Household checked the panel produces
byte-identical output to today, so the change is non-breaking for existing users. The
other four types are additive — checking Wife alone yields a ladies-only mailing.

Name construction rules:

- Sons/Daughters: if `lastName` is blank, fall back to `Family.name`.
- Husband/Wife: if `Family.name` already begins with the first name (case-insensitive,
  trimmed), do not duplicate it — emit `Family.name` alone. This guards against
  `Family.name` values that already include a given name.
- If a recipient's first name is blank, that recipient produces no label. It is not
  counted as a skip (a skip means "excluded by a filter", not "does not exist").

### 2. Marital filter

Values: `any` | `unmarried` | `married`.

- `unmarried` = member has no `weddingDate`. This is the bochur/girl definition.
- `married` = member has a `weddingDate`.
- Applies only to Sons and Daughters. Husband, Wife, and Household ignore it.

Known limitation: `/api/family-members/all` filters out
`convertedToFamily: true`, and the wedding-converter cron promotes members into their
own `Family` on their wedding date. So `married` will match only members whose
`weddingDate` is set but who have not yet been converted. This is acceptable — married
children become their own household and are reachable via Household. Document it in the
UI with a short hint under the marital control.

### 3. Age filter

Two optional number inputs: min age and max age, both inclusive. Age is whole years
computed from `birthDate` against the current date. Applies only to Sons and Daughters.

Missing birth date handling: when **no** age bound is set, members with a blank
`birthDate` are included normally. When **either** bound is set, they are excluded and
counted. The count is surfaced in the UI as e.g. "4 members skipped — no birth date on
file". The count is of distinct members, not of labels.

### 4. Presets

Buttons that only pre-fill the controls above — they hold no state of their own, so the
user can adjust after clicking.

| Preset   | Sets                                         |
| -------- | -------------------------------------------- |
| Ladies   | Wife only; marital `any`; age cleared        |
| Bucherim | Sons only; marital `unmarried`; age cleared  |
| Kids     | Sons + Daughters; marital `any`; age cleared |

### 5. Filter ordering

Existing family-level filters run first, unchanged: payment plan, balance
(all/negative), require street address, name/address search. Person expansion happens
only inside the families that survive those filters. This preserves today's semantics —
for example, "require street address" still drops addressless families, and now drops
all their members too, which is correct since a label with no address is useless.

The name/address search continues to match against family fields only. It does not
search member names. Searching member names is out of scope.

### 6. Data flow

`/api/family-members/all` already returns `firstName`, `lastName`, `birthDate`, and
`gender` grouped by `familyId`, is rate-limited (120/min), and sets a 30s private cache
header. It needs `weddingDate` added to its `.select()` and to the grouped payload —
that is the only server-side change.

`GET /api/families` uses an exclusion projection
(`-deletedAt -deletedBy -deletedKind -updatedAt -__v`), so `husbandFirstName` and
`wifeFirstName` are already returned. No change needed there; only the TypeScript
`FamilyShape` in `LabelsPanel.tsx` and `MailLabelsPanel.tsx` needs widening.
`SettingsView` holds the families array as `any[]`, so it needs no type change.

Members are fetched lazily — only when a recipient type other than Household is first
checked. Household-only users never pay for the request. Follow the existing lazy-fetch
pattern already used in `MailLabelsPanel` for `/api/families/balances` (generation
counter ref to discard stale responses, plus `useOrgChanged` to clear the cache on org
switch). `TaskFormModal.tsx` is the reference for calling this endpoint.

### 7. Module boundaries

**New:** `lib/client/mail-label-audience.ts`

Pure, React-free, no fetching. This lives in `lib/client/` rather than beside the panel
because that is where the repo already keeps pure, unit-tested client helpers
(`families-list.ts`, `family-form.ts`, `useDataFilters.ts`, `export.ts`), and the `app`
vitest project only collects `*.test.tsx` — a `.test.ts` colocated with the component
would silently never run.

Signature:

```ts
export interface LabelRow {
  name: string
  street: string
  cityState: string
}

export interface AudienceFilters {
  recipients: {
    household: boolean
    husband: boolean
    wife: boolean
    sons: boolean
    daughters: boolean
  }
  marital: 'any' | 'unmarried' | 'married'
  minAge: number | null
  maxAge: number | null
}

export function resolveAudience(
  families: FamilyShape[],
  membersByFamily: Record<string, MemberShape[]>,
  filters: AudienceFilters,
  today: Date,
): { rows: LabelRow[]; skippedNoBirthDate: number }
```

`today` is injected rather than read from `new Date()` so age math is deterministic in
tests.

Row ordering: families in their existing order (the API sorts by `name`), and within a
family: Household, Husband, Wife, then Sons and Daughters interleaved in the order the
members endpoint returned them. Stable ordering matters because users re-print sheets.

**Modified:** `app/components/settings/MailLabelsPanel.tsx`

- Extends the `Filters` interface with the new fields
- Adds the recipient checkboxes, marital control, age inputs, and preset buttons
- Marital and age controls are disabled with a muted style unless Sons or Daughters is checked
- Preview header changes from "N families" to "N labels"
- Preview grid renders the first 12 `LabelRow`s (unchanged count)
- Skipped-count notice renders below the preview header when non-zero
- Empty state message updated: the current copy says "No families match" and should say
  "No labels match the current filters"

`buildLabelHTML` and `buildTestSheetHTML` are unchanged — they already take a
`{ name, street, cityState }[]`, which is exactly `LabelRow[]`. The existing
`formatAddressRow(family)` splits into an address-only formatter (per family, reused
across that family's rows) plus per-recipient name construction inside
`resolveAudience`.

**Modified:** `app/settings/panels/LabelsPanel.tsx` — a thin pass-through wrapper that
redeclares `FamilyShape` and `LabelFilters`.

### 8. Filter state persistence

`filters` is owned by `SettingsView` as `labelFilters` and passed down through
`LabelsPanel` to `MailLabelsPanel` via `setFilters`. The new fields join that same
object, so they persist across tab switches exactly as the existing filters do. The
initial-state literal in `SettingsView` needs the new defaults:
`recipients: { household: true, husband: false, wife: false, sons: false, daughters: false }`,
`marital: 'any'`, `minAge: null`, `maxAge: null`.

The filter shape is currently declared in three places — an inline type literal on
`useState` in `SettingsView`, the `LabelFilters` interface in `LabelsPanel`, and the
`Filters` interface in `MailLabelsPanel`. Rather than adding four fields to all three,
extract one exported type (`MailLabelFilters`, alongside `AudienceFilters` in
`lib/client/mail-label-audience.ts`) plus an exported `DEFAULT_MAIL_LABEL_FILTERS`
constant, and import both in all three call sites. This is a targeted cleanup that
directly serves the change; it is not a broader refactor.

### 9. Print behavior

Unchanged. `handlePrint` alerts when the row count is zero (copy updated from "No
families match the current filters" to "No labels match the current filters") and
otherwise opens a print window. Sheet padding to a multiple of 30 already happens inside
`buildLabelHTML`.

## Testing

Unit tests for `mail-label-audience.ts` — it is pure, so this is where the real
coverage goes:

- Household-only reproduces the pre-change output for a fixture family set
- Wife-only yields one row per family that has a `wifeFirstName`, and skips families without one
- Sons + `unmarried` excludes sons with a `weddingDate`
- `minAge: 10` includes a son aged exactly 10, excludes one aged 9
- `maxAge: 12` includes a son aged exactly 12, excludes one aged 13
- Both bounds set: inclusive on both ends
- Blank `birthDate` with no age bound set → included, `skippedNoBirthDate === 0`
- Blank `birthDate` with an age bound set → excluded, counted once
- Member with blank `lastName` falls back to `Family.name`
- Husband name is not duplicated when `Family.name` already starts with the first name
- Recipient with a blank first name produces no row and is not counted as skipped
- Multiple recipient types checked produces rows in the documented order
- Members for a family absent from `membersByFamily` are treated as an empty list, not a crash

No new integration or e2e tests. The panel does no backend writes, and the one server
change (adding `weddingDate` to a projection) is covered by the existing route tests
for `/api/family-members/all`.

## Non-goals

- Person-level audience selection in email communications or automations
- Searching by member name in the labels panel
- Hebrew-name labels (Kevittel already covers Hebrew name sheets)
- Titles/honorifics on labels (Mr./Mrs./Miss)
- Persisting named audience segments for reuse
- Per-person tags or overrides for edge cases the derived rules get wrong
