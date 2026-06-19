/**
 * Cycle rollover — the job that finally makes the "Cycle Configuration"
 * setting do something. Triggered daily by /api/jobs/cycle-rollover.
 *
 * Per org with `cycleAutoRollover: true` whose configured cycle start
 * day matches today (in the org's chosen calendar), this writes one
 * `CycleCharge` per family capturing that cycle's expected dues at the
 * family's CURRENT plan. The charge is then picked up by
 * `calculateFamilyBalance` so multi-year arrears finally accumulate.
 *
 * Idempotency: `CycleCharge` has a partial unique index on
 * (organizationId, familyId, cycleYear). We rely on Mongo to reject
 * duplicates and tolerate E11000 — no in-memory de-dup needed.
 */

import connectDB from '@/lib/database'
import { CycleConfig, PaymentPlan, CycleCharge, Organization } from '@/lib/models'
import { familyBatches } from '@/lib/org-pagination'
import { cycleYearFor } from '@/lib/jobs'
import { logError } from '@/lib/log'

export interface RolloverResult {
  organizationId: string
  cycleYear: number
  calendar: 'gregorian' | 'hebrew'
  /** Families that received a new CycleCharge in this run. */
  charged: number
  /** Families skipped because they already had a charge for this cycleYear. */
  skipped: number
  /** Families skipped because they have no payment plan / a deleted plan. */
  noPlan: number
  errors: { familyId: string; error: string }[]
}

/**
 * Run the cycle rollover for one organization. Caller is responsible
 * for deciding WHETHER to call this — the cron route gates by
 * `cycleAutoRollover` + `cycleScheduleMatcher` first.
 *
 * `chargeDate` is injectable so the cron can use a stable timestamp
 * and tests can pin a specific date. Defaults to now.
 */
export async function runCycleRolloverForOrg(
  organizationId: string,
  chargeDate: Date = new Date(),
): Promise<RolloverResult> {
  await connectDB()

  const config = await CycleConfig.findOne({ organizationId, isActive: true })
    .select('cycleCalendar')
    .lean<any>()

  const org = await Organization.findById(organizationId)
    .select('timezone')
    .lean<{ timezone?: string }>()

  const calendar: 'gregorian' | 'hebrew' =
    config?.cycleCalendar === 'hebrew' ? 'hebrew' : 'gregorian'
  // CycleCharge represents the *just-completed* cycle (per the contract
  // documented in calculateFamilyBalance — CycleCharge captures completed
  // cycles, planCost captures the current in-progress one). The rollover
  // job fires on the FIRST DAY of the new cycle, so the cycle that
  // just ended is one calendar year earlier than the one beginning today.
  //
  // The previous implementation stamped the *new* cycle year here, which
  // caused families to be double-billed for that year: CycleCharge for
  // year Y AND planCost (representing the now-current cycle Y) both
  // appeared in the balance subtraction. Stamping `Y - 1` aligns the
  // semantics with the docstring and makes the math correct.
  //
  // Migration note: orgs that had `cycleAutoRollover` enabled before this
  // fix have historical CycleCharge rows mislabelled as the "new" cycle
  // year. The unique index on (orgId, familyId, cycleYear) will block
  // exact duplicates from re-stamping, so the very first post-fix
  // rollover for those orgs may report `skipped: <n>` instead of
  // `charged: <n>`. That is the correct behavior — those families
  // already have a CycleCharge for the just-completed cycle on file
  // (under its old, off-by-one label). No backfill is needed.
  const cycleYear = cycleYearFor(calendar, chargeDate, org?.timezone) - 1

  // Process families in _id-ordered batches so orgs with >1000 families
  // are not silently truncated.
  const planCache = new Map<string, { name: string; yearlyPrice: number } | null>()
  const getPlan = async (planId: string | null | undefined) => {
    if (!planId) return null
    const key = String(planId)
    if (planCache.has(key)) return planCache.get(key)!
    const plan = await PaymentPlan.findOne({ _id: planId, organizationId }, null, {
      includeDeleted: true,
    })
      .select('name yearlyPrice')
      .lean<any>()
    const cached = plan ? { name: plan.name || '', yearlyPrice: plan.yearlyPrice || 0 } : null
    planCache.set(key, cached)
    return cached
  }

  const result: RolloverResult = {
    organizationId,
    cycleYear,
    calendar,
    charged: 0,
    skipped: 0,
    noPlan: 0,
    errors: [],
  }

  for await (const families of familyBatches(organizationId, {
    select: '_id paymentPlanId',
  })) {
    for (const family of families) {
      const familyId = String(family._id)
      try {
        const plan = await getPlan(family.paymentPlanId ? String(family.paymentPlanId) : null)
        if (!plan || plan.yearlyPrice <= 0) {
          result.noPlan += 1
          continue
        }

        // Rely on the partial unique index for idempotency. A duplicate
        // means we already charged this family for this cycleYear (the
        // cron re-ran, an admin re-triggered, etc.) and we silently skip.
        try {
          await CycleCharge.create({
            organizationId,
            familyId,
            cycleYear,
            calendar,
            chargeDate,
            amount: plan.yearlyPrice,
            planId: family.paymentPlanId,
            planName: plan.name,
            notes: `Annual membership dues — cycle ${cycleYear}`,
          })
          result.charged += 1
        } catch (err: any) {
          if (err?.code === 11000) {
            result.skipped += 1
          } else {
            throw err
          }
        }
      } catch (err: any) {
        result.errors.push({ familyId, error: err?.message || String(err) })
        logError(err, {
          module: 'cycle-rollover',
          organizationId,
          familyId,
          cycleYear,
        })
      }
    }
  }

  return result
}
