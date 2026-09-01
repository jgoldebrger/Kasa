# Dunning arrears automations — Design Spec

**Date:** 2026-08-21  
**Status:** Design approved in conversation; awaiting spec-file review before planning  
**Scope:** First slice of the treasurer feature backlog. Email-only overdue reminders on the existing Communications automations stack. Not a platform rewrite.

## Context

Kasa already emails families from Communications → Automations. `EmailAutomationRule` supports `balance_gt_zero` and `event_within_30_days`. The daily cron `POST /api/jobs/run-email-drips` runs enabled rules, skips opt-out and invalid emails, applies template merge fields, and rate-limits the whole rule with a 24-hour `lastRunAt` gate.

That is not dunning. Treasurers cannot say “owe at least $X and the obligation is at least N days old,” cap sends per family, space retries, or stop after a payment. Today every positive balance is a candidate, and one send for family A blocks the rest of the rule for 24 hours.

This spec adds a third rule type, **`dunning_arrears`**, plus per-family **episodes**. It does not add SMS, dashboard badges, search filters, reconciliation, optimistic locking, custom fields, or a mobile app.

## Goals

- Treasurers configure overdue reminder sequences in the existing Automations UI.
- A family is emailed only when **balance ≥ min owed** and the **obligation is old enough**.
- At most **M** emails per episode, at least **N** days apart.
- Any recorded **payment** closes the episode; a later episode can start if they still qualify after **N** days.
- Failed sends do not consume an attempt.
- Existing `balance_gt_zero` and `event_within_30_days` behavior stays unchanged.

## Non-goals

- Dashboard “days since last payment” / “due soon” widgets
- Family Activity / audit timeline UI
- Per-family pause-dunning control (use `communicationsOptOut`)
- Invoice-line matching or FIFO application of payments to charges
- SMS, A/B subjects, drip sequences beyond M spaced emails
- New public CRUD for episodes
- Changing `calculateFamilyBalance` math

## Decisions

| Topic            | Choice                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------- |
| Trigger          | Org-configurable min owed **and** days since obligation start                                |
| Obligation clock | Earliest `CycleCharge.chargeDate`; else current billing-cycle start; else `family.createdAt` |
| Cadence          | **M** emails per episode, **N** days apart (defaults 3 and 7)                                |
| Close on payment | Any persisted `Payment` row (including $1); not declines, refunds, or withdrawals            |
| Re-entry         | New episode only if still qualifying **and** ≥ N days since last dunning send for that rule  |
| Product surface  | Email engine only                                                                            |
| Architecture     | Extend `EmailAutomationRule`; new `DunningEpisode` collection                                |
| Job              | Same `run-email-drips` cron; dunning skips the whole-rule 24h send gate                      |

## Architecture

### Units

1. **`EmailAutomationRule` (extended)** — treasurer-facing definition: who, which template, thresholds, M/N. Same org scoping as today.
2. **`DunningEpisode`** — runtime state per `(organizationId, familyId, ruleId)` while a sequence is in progress or after it closed. Not edited in the UI.
3. **Qualify helper** — pure-enough function: given family + rule + balance + obligation date + now, return whether they match the trigger (email/opt-out filtered separately).
4. **Episode service** — open, send-due, close on payment, close on max attempts, close when no longer qualifying.
5. **Execute path** — `executeEmailAutomationRule` branches on `ruleType`; dunning uses episode service + existing `sendEmail` / merge fields / pacing.
6. **Payment hook** — after a `Payment` is successfully created, close open episodes for that family in that org.

### Rule fields

Existing: `organizationId`, `name`, `enabled`, `templateId`, `ruleType`, `lastRunAt`, last-run counters, timestamps.

`ruleType` enum adds `dunning_arrears`.

When `ruleType === 'dunning_arrears'` (required):

| Field                 | Constraints                                                      | Default         |
| --------------------- | ---------------------------------------------------------------- | --------------- |
| `minOwed`             | Number, **> 0**, same unit as `calculateFamilyBalance().balance` | none (required) |
| `daysSinceObligation` | Integer 1–3650                                                   | 30              |
| `maxAttempts`         | Integer 1–12                                                     | 3               |
| `intervalDays`        | Integer 1–90                                                     | 7               |

Other rule types must not persist these fields as active criteria (ignore on execute). Validation on create/update: if type is dunning, `minOwed` is required; if type is not dunning, reject a body that only makes sense as dunning (or strip unused fields).

### Episode fields

| Field                                  | Meaning                                              |
| -------------------------------------- | ---------------------------------------------------- |
| `organizationId`, `familyId`, `ruleId` | Identity                                             |
| `status`                               | `open` \| `closed`                                   |
| `sendCount`                            | Successful sends in this episode                     |
| `lastSentAt`                           | Time of last **successful** send                     |
| `closedAt`                             | Set when closed                                      |
| `closedReason`                         | `payment` \| `max_attempts` \| `no_longer_qualifies` |

**Indexes**

- Unique partial index: one **open** episode per `(organizationId, familyId, ruleId)`.
- `{ organizationId: 1, familyId: 1, status: 1 }` for the payment hook.
- `{ organizationId: 1, ruleId: 1, status: 1 }` for the cron.

### Obligation start date

Computed per family, no new stored field on Family:

1. Earliest non-deleted `CycleCharge.chargeDate` for that family in the org. All charges count; we do **not** subtract payments line-by-line (Kasa has no invoice matching).
2. If none: **start of the current billing cycle** from existing `CycleConfig` + org timezone (same calendar helpers the rollover job already uses).
3. If cycle config is missing: `family.createdAt`.

**Days since obligation** = calendar-day difference in the **organization timezone** from obligation start (date-only) to now (date-only). Interval **N** uses the same timezone day-count from `lastSentAt`.

### Qualify

A family **qualifies** for a dunning rule when all are true:

- `calculateFamilyBalance(familyId, organizationId).balance >= minOwed`
- days since obligation start ≥ `daysSinceObligation`
- has email, `emailFormatInvalid` is not true, `communicationsOptOut` is not true
- family exists and is in the org (same visibility as other automation recipients)

### Episode lifecycle

```
no open episode + qualifies
  → open episode, send #1 if send succeeds

open + qualifies + sendCount < M + days since lastSentAt ≥ N
  → send next

open + Payment created for family
  → close (payment)

open + sendCount reaches M after a successful send
  → close (max_attempts)

open + no longer qualifies (and no payment this evaluation)
  → close (no_longer_qualifies)

closed + qualifies + days since last dunning send for this rule ≥ N
  → open a new episode (new document), send #1
```

Re-entry after `max_attempts` or `payment` uses the same N-day quiet period measured from `lastSentAt` of the **closed** episode (copy or query latest episode for that triple). If `lastSentAt` is null (should not happen after a send), do not re-open until a successful historical send exists or N days from `closedAt`.

### Job and 24-hour gate

`executeEmailAutomationRule` today skips the **entire rule** if `lastRunAt` is within 24 hours (unless `force`). For `dunning_arrears` that gate is **off**. The job still runs daily and uses per-family N / M. `lastRunAt` and last-run counters remain telemetry: sent / skipped / failed for that execution.

`force` (manual Run) still bypasses only the old 24h gate. It does **not** bypass M, N, opt-out, invalid email, or missing template.

### Payment close

Any successful `Payment.create` (manual entry, CSV import, Stripe success, recurring charge success) closes **all open** `DunningEpisode` rows for that `(organizationId, familyId)` across **all** dunning rules, reason `payment`. Cron also closes if it sees a payment dated after `lastSentAt` while an episode is still open (backup).

**Not** a closing payment: failed/declined Stripe with no Payment row, refunds, withdrawals, lifecycle event payments that are not `Payment`, deleting or editing a payment. Soft-deleting a payment does not reopen an episode; they may re-qualify on a later cron after N days.

### APIs

Reuse:

- `POST/PATCH /api/email-automation-rules` — zod: new enum value + dunning fields
- `POST /api/email-automation-rules/[id]/preview` — dunning qualify + skip counts
- `POST /api/email-automation-rules/[id]/run` — existing force run
- `POST /api/jobs/run-email-drips` — unchanged URL; new branch inside execute

No `GET /api/dunning-episodes` in this slice.

### UI

Communications → Automations, same form. New option in rule-type select. Show min owed, days since obligation, max attempts, interval days **only** when type is `dunning_arrears`. Preview and last-run stats unchanged. No family-detail or dashboard changes.

Permissions: same as current email automation rules.

### Multiple rules

An org may have several enabled `dunning_arrears` rules (e.g. 30 days / $100 vs 90 days / $500). Episodes are per rule. A family can receive both sequences if they qualify for both. Payment closes all open episodes for that family.

## Data flow

1. Cron lists enabled rules (existing query).
2. For dunning rules, page families with existing `familyBatches`. Compute each candidate’s balance with `calculateFamilyBalance` (correctness over a one-off aggregate). A later optimization may switch to the org batch balance helper in `lib/route-logic/families/balances.ts` only if tests prove it matches `calculateFamilyBalance` for the same `asOf` date.
3. For each family: obligation date → qualify → episode transitions → maybe send.
4. Send: load template, merge fields (existing `loadMergeFieldContext` / `applyMergeFields`), `sendEmail`, then increment episode.
5. Persist rule last-run stats.

Pacing: existing `delayBetweenSendsMs` / `sleep` between successful-attempt **tries** for that run.

## Error handling

| Case                                  | Behavior                                                                                                                                                                                           |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Template missing subject/html         | Skip rule; same as today; do not open new episodes for a send that cannot happen                                                                                                                   |
| SMTP/send failure                     | Do not increment `sendCount` or `lastSentAt`; `lastRunFailedCount++`; episode stays open                                                                                                           |
| Duplicate cron                        | Unique open episode + N-day check prevents double send                                                                                                                                             |
| Family has no obligation date         | Always has fallback `createdAt`                                                                                                                                                                    |
| `minOwed` invalid                     | 400 on create/update                                                                                                                                                                               |
| Send succeeds then DB increment fails | Log error; next run may retry (possible duplicate email). Prefer increment in the same success path immediately after send; acceptable residual risk documented, no two-phase outbox in this slice |
| Org missing                           | Skip (existing drip loop)                                                                                                                                                                          |

Audit: keep rule create/update/run audit. Add one audit event per **successful** dunning send (`resourceType` family or rule, include `familyId`, `ruleId`). No new UI.

## Testing

- Qualify: below min owed; obligation too recent; opted out; invalid email; `createdAt` fallback does not qualify on day zero if `daysSinceObligation ≥ 1`.
- Episode: first send; wait N days; stop at M; payment closes; re-open after N if still over min; send failure does not consume attempt.
- Payment hook: Payment create closes open episodes; declined charge without Payment does not.
- Regression: `balance_gt_zero` still uses 24h gate and positive-balance recipients.
- Preview recipient count matches execute candidates for a frozen clock.

## Implementation notes (for the plan, not extra product)

- Schema: `lib/models/email-automation-rule.ts`, new `lib/models/dunning-episode.ts`, export from `lib/models/index.ts`.
- Zod: `lib/schemas/email-automation-rule.ts`.
- Logic: `resolve-recipients.ts` or a sibling `dunning.ts`; `execute-rule.ts`; payment create sites share one `closeDunningEpisodesForPayment({ organizationId, familyId })`.
- UI: `app/communications/_components/AutomationsView.tsx` + `types.ts` + i18n keys in all locale files the automations screen already uses.
- Do not add a second cron route.

## Later backlog (explicitly not this spec)

Family search filters, audit Activity tab, recurring pause/skip, CSV reconciliation, optimistic locking, multi-currency polish, custom fields, mobile app, dunning dashboard badges.
