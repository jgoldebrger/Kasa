/**
 * Bulk family balance summary.
 *
 * GET /api/families/balances — returns one record per family in the
 * active org with the same balance formula used by
 * `calculateFamilyBalance` in lib/calculations.ts:
 *   balance = totalPayments - totalWithdrawals - totalCycleCharges - planCost
 *
 * Optional `?familyIds=id1,id2,...` scopes the response to those families
 * (max FAMILY_BALANCES_IDS_CAP ids). When omitted, every family in the
 * org is included — used by export flows and mail-label filters.
 *
 * We deliberately use a handful of aggregation pipelines (one per
 * collection) rather than calling `calculateFamilyBalance` in a loop:
 * - keeps the cost flat-N on the DB side even for 500-family orgs
 * - avoids the per-family `connectDB()` re-entry inside the helper
 *
 * Read-only; cached per-user for 30s with SWR — labels / receipts use
 * this for "negative balance" filtering which doesn't need to be
 * second-perfect.
 */

import { Types } from 'mongoose'
import { z } from 'zod'
import { handler } from '@/lib/api/handler'
import {
  PaymentPlan,
  Payment,
  Withdrawal,
  CycleCharge,
  Family,
} from '@/lib/models'
import { loadAllByIdCursor, familyBatches, loadByIdsInChunks } from '@/lib/org-pagination'
import { checkRateLimit } from '@/lib/rate-limit'
import { FAMILY_BALANCES_IDS_CAP, objectId } from '@/lib/schemas'

export const dynamic = 'force-dynamic'

const balancesQuery = z.object({
  familyIds: z.preprocess(
    (val) => {
      if (val === undefined || val === null || val === '') return undefined
      if (typeof val !== 'string') return val
      const ids = val
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      return ids.length > 0 ? ids : undefined
    },
    z.array(objectId).max(FAMILY_BALANCES_IDS_CAP).optional(),
  ),
})

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  query: balancesQuery,
  name: 'GET /api/families/balances',
  fn: async ({ ctx, query, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'families-balances',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const orgId = new Types.ObjectId(String(ctx!.organizationId))
    const scopedIds = query.familyIds

    // Lookup plan yearly prices once, then resolve per-family planCost
    // in JS — much cheaper than a $lookup join.
    const plans = await loadAllByIdCursor<any>(
      (filter, limit) =>
        PaymentPlan.find(filter).select('_id yearlyPrice').sort({ _id: 1 }).limit(limit).lean<any[]>(),
      { organizationId: orgId },
    )

    const families: Array<{ _id: unknown; paymentPlanId?: unknown }> = []
    if (scopedIds) {
      const loaded = await loadByIdsInChunks(
        (ids) =>
          Family.find({ organizationId: orgId, _id: { $in: ids } })
            .select('_id paymentPlanId')
            .lean<Array<{ _id: unknown; paymentPlanId?: unknown }>>(),
        scopedIds,
      )
      const byId = new Map(loaded.map((f) => [String(f._id), f]))
      for (const id of scopedIds) {
        const fam = byId.get(id)
        if (fam) families.push(fam)
      }
    } else {
      for await (const batch of familyBatches(String(ctx!.organizationId), {
        select: '_id paymentPlanId',
      })) {
        families.push(...batch)
      }
    }

    const planPriceById = new Map<string, number>()
    for (const p of plans) planPriceById.set(String(p._id), Number(p.yearlyPrice || 0))

    const familyMatch =
      scopedIds && scopedIds.length > 0
        ? {
            familyId: {
              $in: scopedIds.map((id) => new Types.ObjectId(id)),
            },
          }
        : {}

    // Three parallel sum-by-family aggregations.
    // Notes:
    //   - `deletedAt: null` is required explicitly: Mongoose's soft-delete
    //     plugin installs `pre('find', …)` hooks, but `aggregate()`
    //     bypasses those hooks. Without this clause, soft-deleted
    //     payments / withdrawals / cycle charges would silently inflate
    //     totals here even though `calculateFamilyBalance` (which uses
    //     `.find()`) filters them out — and the two views would disagree.
    //   - `Payment.amount` must be netted against `refundedAmount` to
    //     stay consistent with `calculateFamilyBalance`, otherwise a
    //     refunded charge would still count as money received in the
    //     bulk view.
    const [paySums, withSums, cycleSums] = await Promise.all([
      Payment.aggregate([
        { $match: { organizationId: orgId, deletedAt: null, ...familyMatch } },
        {
          $group: {
            _id: '$familyId',
            total: {
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
            },
          },
        },
      ]),
      Withdrawal.aggregate([
        { $match: { organizationId: orgId, deletedAt: null, ...familyMatch } },
        { $group: { _id: '$familyId', total: { $sum: '$amount' } } },
      ]),
      CycleCharge.aggregate([
        { $match: { organizationId: orgId, deletedAt: null, ...familyMatch } },
        { $group: { _id: '$familyId', total: { $sum: '$amount' } } },
      ]),
    ])

    const sumMap = (rows: any[]) => {
      const m = new Map<string, number>()
      for (const r of rows) m.set(String(r._id), Number(r.total || 0))
      return m
    }
    const payByFamily = sumMap(paySums)
    const withByFamily = sumMap(withSums)
    const cycleByFamily = sumMap(cycleSums)

    const items = families.map((f) => {
      const id = String(f._id)
      const planId = f.paymentPlanId ? String(f.paymentPlanId) : null
      const planCost = planId ? planPriceById.get(planId) || 0 : 0
      const totalPayments = payByFamily.get(id) || 0
      const totalWithdrawals = withByFamily.get(id) || 0
      const totalCycleCharges = cycleByFamily.get(id) || 0
      const balance = totalPayments - totalWithdrawals - totalCycleCharges - planCost
      return {
        familyId: id,
        balance,
        totalPayments,
        totalWithdrawals,
        totalCycleCharges,
        planCost,
      }
    })

    return {
      data: items,
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=300' },
    }
  },
})
