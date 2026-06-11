// Yearly + per-family/member calculation engine.
//
// All math is fully dynamic per organization:
//   - Payment plans come from the PaymentPlan collection
//     (`name`, `planNumber`, `yearlyPrice`). There is no fixed cap of four.
//   - Lifecycle event types come from the LifecycleEvent collection
//     (`type`, `name`, `amount`). There are no built-in event types.
//
// The yearly snapshot persists two flexible arrays — `byPlan` and
// `byEvent` — alongside the headline aggregates the dashboard reads
// (`calculatedIncome`, `calculatedExpenses`, `balance`, …).

import {
  Family,
  FamilyMember,
  Payment,
  Withdrawal,
  LifecycleEvent,
  LifecycleEventPayment,
  YearlyCalculation,
  PaymentPlan,
  CycleCharge,
  Organization,
} from './models'
import connectDB from './database'
import { calendarYearBoundsInTimeZone } from './date-utils'
import { Types } from 'mongoose'
import { familyBatches, familyMemberBatches, loadAllByIdCursor } from './org-pagination'

async function sumAggregate(
  model: { aggregate: (pipeline: unknown[]) => Promise<Array<{ total?: number }>> },
  match: Record<string, unknown>,
  sumExpression: Record<string, unknown>,
): Promise<number> {
  const rows = await model.aggregate([
    { $match: match },
    { $group: { _id: null, total: sumExpression } },
  ])
  return roundMoneyValue(Number(rows[0]?.total ?? 0))
}

const NET_PAYMENT_SUM = {
  $sum: {
    $max: [
      0,
      {
        $subtract: [
          { $ifNull: ['$amount', 0] },
          { $ifNull: ['$refundedAmount', 0] },
        ],
      },
    ],
  },
} as const

const AMOUNT_SUM = { $sum: { $ifNull: ['$amount', 0] } } as const

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Age (in completed years) of `birthDate` as of `referenceDate`. */
export function calculateAge(birthDate: Date, referenceDate: Date = new Date()): number {
  const birth = new Date(birthDate)
  const ref = new Date(referenceDate)
  if (!Number.isFinite(birth.getTime()) || !Number.isFinite(ref.getTime())) {
    return NaN
  }
  let age = ref.getFullYear() - birth.getFullYear()
  const monthDiff = ref.getMonth() - birth.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && ref.getDate() < birth.getDate())) {
    age--
  }
  return age
}

/** Age of `birthDate` measured at December 31st of `year`. */
export function calculateAgeInYear(birthDate: Date, year: number): number {
  const yearEnd = new Date(year, 11, 31)
  return calculateAge(birthDate, yearEnd)
}

// ---------------------------------------------------------------------------
// Per-organization breakdown types
// ---------------------------------------------------------------------------

export interface PlanBreakdown {
  planId: string
  planNumber: number
  name: string
  yearlyPrice: number
  /** Members assigned to this plan (via family or member override). */
  count: number
  /** Families assigned to this plan. Drives the income calculation. */
  familyCount: number
  /**
   * Expected yearly income from this plan. Computed as
   * `familyCount * yearlyPrice` — plans in this system are family-priced
   * (cycle-rollover.ts charges ONE CycleCharge per family per year
   * regardless of family size). Member-level paymentPlanId overrides
   * affect only the per-member balance display, not what the family is
   * billed.
   */
  income: number
}

export interface EventBreakdown {
  type: string
  name: string
  configuredAmount: number
  count: number
  amount: number
}

// ---------------------------------------------------------------------------
// Member → plan attribution
// ---------------------------------------------------------------------------

/**
 * Count members per PaymentPlan for an org, returning one entry per
 * configured plan (including zero-count entries so the UI can render a
 * stable row order).
 *
 * Attribution rule: every member counts under their family's
 * `paymentPlanId`. If a member explicitly overrides via their own
 * `paymentPlanId`, that wins. Families without a valid `paymentPlanId`
 * contribute no members to any plan and we log a warning so the org can
 * fix the data.
 */
/**
 * @param _year — accepted for signature symmetry with `calculateYearlyIncome`
 *   but intentionally ignored. The function uses CURRENT roster + plan
 *   assignments because we don't retain point-in-time snapshots. See the
 *   "KNOWN LIMITATION" block on `calculateYearlyIncome`.
 */
export async function countMembersByPaymentPlan(
  _year: number,
  organizationId: string,
): Promise<PlanBreakdown[]> {
  await connectDB()

  const plans = await loadAllByIdCursor<any>(
    (filter, limit) =>
      PaymentPlan.find(filter).sort({ planNumber: 1, _id: 1 }).limit(limit).lean<any[]>(),
    { organizationId },
  )

  if (plans.length === 0) return []

  const byId = new Map<string, PlanBreakdown>()
  for (const plan of plans) {
    byId.set(String(plan._id), {
      planId: String(plan._id),
      planNumber: plan.planNumber ?? 0,
      name: plan.name ?? '',
      yearlyPrice: plan.yearlyPrice ?? 0,
      count: 0,
      familyCount: 0,
      income: 0,
    })
  }

  // Pass 1: gather families and bump familyCount + income on the
  // family's plan. This is the SOURCE OF TRUTH for income — plans are
  // family-priced (see cycle-rollover.ts which charges one CycleCharge
  // per family at `plan.yearlyPrice` regardless of family size).
  const activeFamilyIds = new Set<string>()
  const familyPlan = new Map<string, string | null>()
  for await (const batch of familyBatches(organizationId, { select: '_id paymentPlanId' })) {
    for (const family of batch) {
      const id = String(family._id)
      activeFamilyIds.add(id)
      const planId = family.paymentPlanId ? String(family.paymentPlanId) : null
      familyPlan.set(id, planId)
      if (planId) {
        const bucket = byId.get(planId)
        if (bucket) {
          bucket.familyCount += 1
          bucket.income += bucket.yearlyPrice
        }
      }
    }
  }

  // Pass 2: gather members and bump `count` (display only). The member
  // override on `paymentPlanId` shifts a member into a different plan's
  // tally for the breakdown table — but does NOT add additional income,
  // because the family is billed once for its own plan and the override
  // only changes how the per-member balance is rendered.
  for await (const members of familyMemberBatches(
    organizationId,
    { convertedToFamily: { $ne: true } },
    { select: 'familyId paymentPlanId' },
  )) {
    for (const member of members) {
      if (!member.familyId || !activeFamilyIds.has(String(member.familyId))) continue
      const memberPlanId = member.paymentPlanId ? String(member.paymentPlanId) : null
      const familyPlanId = familyPlan.get(String(member.familyId)) ?? null
      const effectivePlanId = memberPlanId ?? familyPlanId
      if (!effectivePlanId) continue
      const bucket = byId.get(effectivePlanId)
      if (!bucket) continue
      bucket.count += 1
    }
  }

  return Array.from(byId.values())
}

// ---------------------------------------------------------------------------
// Yearly income
// ---------------------------------------------------------------------------

/**
 * Build the MongoDB filter that selects the payments belonging to a
 * given bookkeeping year for an org.
 *
 * `Payment.year` is the explicit source of truth — when set, a payment
 * is counted under exactly that year regardless of its `paymentDate`.
 * `paymentDate` is only consulted as a fallback when `year` is missing
 * (or null), so a payment can never be counted under two different
 * years across runs and `totalPayments` stays self-consistent.
 *
 * Note: in MongoDB, `{ field: null }` matches documents where the field
 * is either explicitly null or absent, so the fallback branch covers
 * both shapes without a separate `$exists` clause.
 */
export function buildPaymentYearFilter(
  year: number,
  organizationId: string,
  tz?: string | null,
) {
  const { start: startDate, endExclusive } = calendarYearBoundsInTimeZone(year, tz ?? 'UTC')
  return {
    organizationId,
    $or: [
      { year },
      { year: null, paymentDate: { $gte: startDate, $lt: endExclusive } },
    ],
  }
}

/**
 * Compute yearly income for an org based on its configured payment plans.
 *
 * `totalPayments` is informational (sum of actual payments hitting the
 * books that year — computed against the supplied `year`) and intentionally
 * NOT folded into income — income is the *expected* revenue from plan
 * assignments, not cash received.
 *
 * KNOWN LIMITATION — historical reconstruction is approximate.
 *
 * The `byPlan` / `planIncome` portion of the result is computed from the
 * CURRENT family roster + plan assignments, not from how the roster
 * looked on Dec 31 of `year`. We do not retain point-in-time snapshots of
 * either Family.paymentPlanId or membership rolls, so calling this for an
 * older year answers "what would these families bill at if I rolled the
 * cycle today?" — not "what was actually billed for `year`". The
 * `totalPayments` field is correctly bounded to `year` (it queries the
 * Payment collection with `buildPaymentYearFilter(year, ...)`), so cash
 * reconciliation against deposits is accurate. Don't use `planIncome` as
 * a historical figure without that caveat.
 *
 * Long-term fix would be a YearlyCalculation snapshot taken at end-of-year
 * — out of scope for this function.
 */
export async function calculateYearlyIncome(
  year: number,
  organizationId: string,
  extraDonation: number = 0,
) {
  await connectDB()

  // NOTE: byPlan is "as of today" — see the JSDoc above. The `year` is
  // forwarded purely so the signature keeps a single source of truth on
  // what the caller is asking about; the underlying counter does not
  // (and cannot, without a historical snapshot model) honor it.
  const byPlan = await countMembersByPaymentPlan(year, organizationId)
  const planIncome = byPlan.reduce((sum, p) => sum + p.income, 0)

  const org = await Organization.findById(organizationId)
    .select('timezone')
    .lean<{ timezone?: string }>()

  const paymentFilter = {
    ...buildPaymentYearFilter(year, organizationId, org?.timezone),
    organizationId: Types.ObjectId.isValid(organizationId)
      ? new Types.ObjectId(organizationId)
      : organizationId,
    deletedAt: null,
  }
  const totalPayments = await sumAggregate(
    Payment as unknown as { aggregate: (pipeline: unknown[]) => Promise<Array<{ total?: number }>> },
    paymentFilter,
    NET_PAYMENT_SUM,
  )

  const totalIncome = planIncome
  const calculatedIncome = roundMoneyValue(planIncome + (Number(extraDonation) || 0))

  return {
    byPlan,
    totalPayments,
    planIncome,
    totalIncome,
    extraDonation: extraDonation || 0,
    calculatedIncome,
  }
}

// ---------------------------------------------------------------------------
// Lifecycle events
// ---------------------------------------------------------------------------

/**
 * Count lifecycle event payments for a year, grouped by the org's
 * configured event types. Configured types with zero events for the year
 * still appear (count 0, amount 0) so the UI shows a stable row set.
 * Event payments whose `eventType` no longer matches a configured type
 * are still summed under their original `eventType` so historical totals
 * don't silently vanish if the org renames/removes a type.
 */
export async function countLifecycleEvents(
  year: number,
  organizationId: string,
): Promise<EventBreakdown[]> {
  await connectDB()

  const configured = await loadAllByIdCursor<any>(
    (filter, limit) =>
      LifecycleEvent.find(filter).sort({ name: 1, _id: 1 }).limit(limit).lean<any[]>(),
    { organizationId },
  )

  const byType = new Map<string, EventBreakdown>()
  for (const ev of configured) {
    const type = String(ev.type || '').toLowerCase()
    if (!type) continue
    byType.set(type, {
      type,
      name: ev.name || type,
      configuredAmount: ev.amount ?? 0,
      count: 0,
      amount: 0,
    })
  }

  const paymentAgg = await LifecycleEventPayment.aggregate([
    {
      $match: {
        organizationId: new Types.ObjectId(organizationId),
        year,
        deletedAt: null,
      },
    },
    {
      $group: {
        _id: { $toLower: { $ifNull: ['$eventType', ''] } },
        count: { $sum: 1 },
        amount: { $sum: { $ifNull: ['$amount', 0] } },
      },
    },
  ])

  for (const row of paymentAgg) {
    const type = String(row._id || '').toLowerCase()
    if (!type) continue
    let bucket = byType.get(type)
    if (!bucket) {
      bucket = { type, name: type, configuredAmount: 0, count: 0, amount: 0 }
      byType.set(type, bucket)
    }
    bucket.count += Number(row.count || 0)
    const rowAmount = Number(row.amount || 0)
    if (Number.isFinite(rowAmount) && rowAmount >= 0) {
      bucket.amount += rowAmount
    }
  }

  return Array.from(byType.values())
}

// ---------------------------------------------------------------------------
// Yearly expenses
// ---------------------------------------------------------------------------

export async function calculateYearlyExpenses(
  year: number,
  organizationId: string,
  extraExpense: number = 0,
) {
  const byEvent = await countLifecycleEvents(year, organizationId)
  const totalExpenses = roundMoneyValue(byEvent.reduce((sum, e) => sum + (e.amount || 0), 0))
  const calculatedExpenses = roundMoneyValue(totalExpenses + (Number(extraExpense) || 0))

  return {
    byEvent,
    totalExpenses,
    extraExpense: extraExpense || 0,
    calculatedExpenses,
  }
}

// ---------------------------------------------------------------------------
// Yearly balance + persistence
// ---------------------------------------------------------------------------

export async function calculateYearlyBalance(
  year: number,
  organizationId: string,
  extraDonation: number = 0,
  extraExpense: number = 0,
) {
  const incomeData = await calculateYearlyIncome(year, organizationId, extraDonation)
  const expenseData = await calculateYearlyExpenses(year, organizationId, extraExpense)
  const balance = incomeData.calculatedIncome - expenseData.calculatedExpenses

  return {
    byPlan: incomeData.byPlan,
    byEvent: expenseData.byEvent,
    totalPayments: incomeData.totalPayments,
    planIncome: incomeData.planIncome,
    totalIncome: incomeData.totalIncome,
    totalExpenses: expenseData.totalExpenses,
    extraDonation: incomeData.extraDonation,
    extraExpense: expenseData.extraExpense,
    calculatedIncome: incomeData.calculatedIncome,
    calculatedExpenses: expenseData.calculatedExpenses,
    balance,
  }
}

/**
 * Compute and upsert the YearlyCalculation snapshot for one (org, year)
 * pair. Writes only the fields declared on the schema; Mongoose's
 * `strict: true` default silently drops anything else, so no manual
 * legacy-field scrubbing is needed.
 */
export async function calculateAndSaveYear(
  year: number,
  organizationId: string,
  extraDonation: number = 0,
  extraExpense: number = 0,
) {
  await connectDB()

  const data = await calculateYearlyBalance(year, organizationId, extraDonation, extraExpense)

  const calculation = await YearlyCalculation.findOneAndUpdate(
    { year, organizationId },
    { $set: { ...data, year, organizationId } },
    { upsert: true, new: true },
  )

  return calculation
}

/**
 * Recompute and persist the snapshot when a lifecycle event is added /
 * edited / removed. Preserves the org's existing extraDonation /
 * extraExpense overrides.
 */
export async function updateYearlyCalculationForEvent(
  eventYear: number,
  organizationId: string,
) {
  try {
    await connectDB()
    const existing = await YearlyCalculation.findOne({ year: eventYear, organizationId })
      .select('extraDonation extraExpense')
      .lean<any>()
    const extraDonation = existing?.extraDonation || 0
    const extraExpense = existing?.extraExpense || 0
    await calculateAndSaveYear(eventYear, organizationId, extraDonation, extraExpense)
  } catch (error) {
    console.error(`Error updating yearly calculation for year ${eventYear}:`, error)
  }
}

// ---------------------------------------------------------------------------
// Per-family / per-member balances
// ---------------------------------------------------------------------------

/**
 * Balance for a specific family (org-scoped). Plan cost comes solely from
 * the family's assigned PaymentPlan — no defaults, no fallbacks. If the
 * family has no plan or its plan was deleted, planCost is 0.
 *
 * The formula is:
 *     balance = totalPayments
 *             - totalWithdrawals
 *             - totalCycleCharges   // completed prior cycles
 *             - planCost            // the current, in-progress cycle
 *
 * `planCost` is always exactly ONE year of the family's current plan and
 * represents the cycle they're currently in. Once the cycle-rollover
 * cron fires for a new cycle it stamps a `CycleCharge` row capturing the
 * just-completed cycle's expected dues — those rows accumulate in
 * `totalCycleCharges` so multi-year arrears finally show up correctly.
 *
 * For orgs that haven't enabled `cycleAutoRollover` there will be no
 * CycleCharge rows and the behavior collapses back to the old
 * one-year-only math, so nothing changes for them until they opt in.
 */
export async function calculateFamilyBalance(
  familyId: string,
  organizationId: string,
  asOfDate: Date = new Date(),
) {
  await connectDB()

  const family = await Family.findOne({ _id: familyId, organizationId })
  if (!family) throw new Error('Family not found')

  let planCost = 0
  if (family.paymentPlanId) {
    try {
      const plan = await PaymentPlan.findOne({ _id: family.paymentPlanId, organizationId }, null, {
        includeDeleted: true,
      })
        .select('yearlyPrice')
        .lean<any>()
      planCost = plan?.yearlyPrice || 0
    } catch (error) {
      console.error(`Error fetching payment plan by ID ${family.paymentPlanId}:`, error)
    }
  }

  const orgOid = new Types.ObjectId(organizationId)
  const famOid = new Types.ObjectId(familyId)
  const notDeleted = { deletedAt: null }

  const [totalPayments, totalWithdrawals, totalLifecyclePayments, totalCycleCharges] =
    await Promise.all([
      sumAggregate(
        Payment as unknown as { aggregate: (pipeline: unknown[]) => Promise<Array<{ total?: number }>> },
        { organizationId: orgOid, familyId: famOid, paymentDate: { $lte: asOfDate }, ...notDeleted },
        NET_PAYMENT_SUM,
      ),
      sumAggregate(
        Withdrawal as unknown as { aggregate: (pipeline: unknown[]) => Promise<Array<{ total?: number }>> },
        { organizationId: orgOid, familyId: famOid, withdrawalDate: { $lte: asOfDate }, ...notDeleted },
        AMOUNT_SUM,
      ),
      sumAggregate(
        LifecycleEventPayment as unknown as { aggregate: (pipeline: unknown[]) => Promise<Array<{ total?: number }>> },
        { organizationId: orgOid, familyId: famOid, eventDate: { $lte: asOfDate }, ...notDeleted },
        AMOUNT_SUM,
      ),
      sumAggregate(
        CycleCharge as unknown as { aggregate: (pipeline: unknown[]) => Promise<Array<{ total?: number }>> },
        { organizationId: orgOid, familyId: famOid, chargeDate: { $lte: asOfDate }, ...notDeleted },
        AMOUNT_SUM,
      ),
    ])

  const balance = roundMoneyValue(
    totalPayments - totalWithdrawals - totalCycleCharges - planCost,
  )

  return {
    openingBalance: roundMoneyValue(0),
    planCost,
    totalPayments,
    totalWithdrawals,
    totalLifecyclePayments,
    totalCycleCharges,
    balance,
  }
}

function roundMoneyValue(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100) / 100
}

/**
 * Balance for a specific member (org-scoped). Plan cost is exclusively
 * driven by `member.paymentPlanId`. No hardcoded price fallbacks.
 */
export async function calculateMemberBalance(
  memberId: string,
  organizationId: string,
  asOfDate: Date = new Date(),
) {
  await connectDB()

  const member = await FamilyMember.findOne({ _id: memberId, organizationId })
  if (!member) throw new Error('Member not found')

  let planCost = 0
  if (member.paymentPlanId) {
    try {
      const plan = await PaymentPlan.findOne({ _id: member.paymentPlanId, organizationId }, null, {
        includeDeleted: true,
      })
        .select('yearlyPrice')
        .lean<any>()
      planCost = plan?.yearlyPrice || 0
    } catch (error) {
      console.error(`Error fetching payment plan for member ${memberId}:`, error)
    }
  }

  const orgOid = new Types.ObjectId(organizationId)
  const memOid = new Types.ObjectId(memberId)
  const notDeleted = { deletedAt: null }

  const [totalPayments, totalLifecyclePayments] = await Promise.all([
    sumAggregate(
      Payment as unknown as { aggregate: (pipeline: unknown[]) => Promise<Array<{ total?: number }>> },
      { organizationId: orgOid, memberId: memOid, paymentDate: { $lte: asOfDate }, ...notDeleted },
      NET_PAYMENT_SUM,
    ),
    sumAggregate(
      LifecycleEventPayment as unknown as { aggregate: (pipeline: unknown[]) => Promise<Array<{ total?: number }>> },
      { organizationId: orgOid, memberId: memOid, eventDate: { $lte: asOfDate }, ...notDeleted },
      AMOUNT_SUM,
    ),
  ])

  const balance = roundMoneyValue(totalPayments - planCost)

  return {
    planCost,
    totalPayments,
    totalLifecyclePayments,
    balance,
  }
}
