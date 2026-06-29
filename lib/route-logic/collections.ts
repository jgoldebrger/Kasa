import { Types } from 'mongoose'
import { z } from 'zod'
import { handler } from '@/lib/api/handler'
import { PaymentPlan, Payment, Withdrawal, CycleCharge } from '@/lib/models'
import { loadAllByIdCursor, familyBatches } from '@/lib/org-pagination'
import { checkRateLimit } from '@/lib/rate-limit'

export const DELINQUENT_PREVIEW_LIMIT = 5

export const AGING_BUCKET_DAYS = [30, 60, 90] as const
export type AgingBucket = (typeof AGING_BUCKET_DAYS)[number] | 'all'

export interface DelinquentFamilyRow {
  familyId: string
  familyName: string
  balance: number
  amountOwed: number
  lastPaymentDate: Date | string | null
  daysOverdue: number | null
}

export interface DelinquencyAgingBuckets {
  days30: number
  days60: number
  days90: number
}

export interface DelinquencySummary {
  count: number
  items: DelinquentFamilyRow[]
  aging: DelinquencyAgingBuckets | null
}

const MS_PER_DAY = 86_400_000

/** Whole calendar days between two instants (floor). */
export function daysBetween(earlier: Date, later: Date): number {
  const diff = later.getTime() - earlier.getTime()
  if (diff <= 0) return 0
  return Math.floor(diff / MS_PER_DAY)
}

export function isDelinquentBalance(balance: number): boolean {
  return Number.isFinite(balance) && balance < 0
}

/**
 * Days overdue when balance is negative: days since last payment, else wedding
 * date, else account created date. Returns null when no anchor exists.
 */
export function resolveDaysOverdue(
  anchors: {
    lastPaymentDate?: Date | string | null
    weddingDate?: Date | string | null
    createdAt?: Date | string | null
  },
  ref: Date = new Date(),
): number | null {
  const dates: Date[] = []
  for (const raw of [anchors.lastPaymentDate, anchors.weddingDate, anchors.createdAt]) {
    if (!raw) continue
    const d = raw instanceof Date ? raw : new Date(raw)
    if (!Number.isNaN(d.getTime())) dates.push(d)
  }
  if (dates.length === 0) return null
  const anchor = dates[0]
  return daysBetween(anchor, ref)
}

export function computeAgingBuckets(
  rows: Array<{ daysOverdue: number | null }>,
): DelinquencyAgingBuckets | null {
  let days30 = 0
  let days60 = 0
  let days90 = 0
  let hasAny = false

  for (const row of rows) {
    const days = row.daysOverdue
    if (days == null || days < 30) continue
    hasAny = true
    if (days >= 90) days90++
    else if (days >= 60) days60++
    else days30++
  }

  return hasAny ? { days30, days60, days90 } : null
}

export function filterByAgingBucket(
  rows: DelinquentFamilyRow[],
  bucket: AgingBucket,
): DelinquentFamilyRow[] {
  if (bucket === 'all') return rows
  return rows.filter((row) => {
    const days = row.daysOverdue
    if (days == null) return false
    if (bucket === 90) return days >= 90
    if (bucket === 60) return days >= 60 && days < 90
    return days >= 30 && days < 60
  })
}

type FamilyBalanceRow = {
  familyId: string
  balance: number
  familyName: string
  weddingDate?: Date | string | null
  createdAt?: Date | string | null
}

async function loadFamilyBalanceRows(organizationId: string): Promise<FamilyBalanceRow[]> {
  const orgId = new Types.ObjectId(String(organizationId))

  const plans = await loadAllByIdCursor<any>(
    (filter, limit) =>
      PaymentPlan.find(filter)
        .select('_id yearlyPrice')
        .sort({ _id: 1 })
        .limit(limit)
        .lean<any[]>(),
    { organizationId: orgId },
  )

  const families: Array<{
    _id: unknown
    paymentPlanId?: unknown
    name: string
    weddingDate?: Date | string | null
    createdAt?: Date | string | null
  }> = []

  for await (const batch of familyBatches(String(organizationId), {
    select: '_id paymentPlanId name weddingDate createdAt',
  })) {
    families.push(
      ...batch.map((row) => ({
        ...row,
        name: row.name ?? '',
      })),
    )
  }

  const planPriceById = new Map<string, number>()
  for (const p of plans) planPriceById.set(String(p._id), Number(p.yearlyPrice || 0))

  const [paySums, withSums, cycleSums] = await Promise.all([
    Payment.aggregate([
      { $match: { organizationId: orgId, deletedAt: null } },
      {
        $group: {
          _id: '$familyId',
          total: {
            $sum: {
              $max: [
                0,
                {
                  $subtract: [{ $ifNull: ['$amount', 0] }, { $ifNull: ['$refundedAmount', 0] }],
                },
              ],
            },
          },
        },
      },
    ]),
    Withdrawal.aggregate([
      { $match: { organizationId: orgId, deletedAt: null } },
      { $group: { _id: '$familyId', total: { $sum: '$amount' } } },
    ]),
    CycleCharge.aggregate([
      { $match: { organizationId: orgId, deletedAt: null } },
      { $group: { _id: '$familyId', total: { $sum: '$amount' } } },
    ]),
  ])

  const sumMap = (rows: Array<{ _id: unknown; total?: number }>) => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(String(r._id), Number(r.total || 0))
    return m
  }

  const payByFamily = sumMap(paySums)
  const withByFamily = sumMap(withSums)
  const cycleByFamily = sumMap(cycleSums)

  return families.map((f) => {
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
      familyName: f.name,
      weddingDate: f.weddingDate,
      createdAt: f.createdAt,
    }
  })
}

async function loadLastPaymentByFamily(
  organizationId: string,
  familyIds: string[],
): Promise<Map<string, Date>> {
  if (familyIds.length === 0) return new Map()

  const orgId = new Types.ObjectId(String(organizationId))
  const objectIds = familyIds.map((id) => new Types.ObjectId(id))

  const rows = await Payment.aggregate([
    {
      $match: {
        organizationId: orgId,
        deletedAt: null,
        familyId: { $in: objectIds },
      },
    },
    { $group: { _id: '$familyId', lastPaymentDate: { $max: '$paymentDate' } } },
  ])

  const map = new Map<string, Date>()
  for (const row of rows) {
    if (row.lastPaymentDate) map.set(String(row._id), new Date(row.lastPaymentDate))
  }
  return map
}

/** Delinquent families sorted by amount owed (desc), with aging buckets. */
export async function loadDelinquencySummary(
  organizationId: string,
  opts?: { previewLimit?: number; ref?: Date },
): Promise<DelinquencySummary> {
  const ref = opts?.ref ?? new Date()
  const previewLimit = opts?.previewLimit

  const balanceRows = await loadFamilyBalanceRows(organizationId)
  const delinquent = balanceRows.filter((r) => isDelinquentBalance(r.balance))

  if (delinquent.length === 0) {
    return { count: 0, items: [], aging: null }
  }

  const lastPayMap = await loadLastPaymentByFamily(
    organizationId,
    delinquent.map((r) => r.familyId),
  )

  const items: DelinquentFamilyRow[] = delinquent
    .map((row) => {
      const lastPaymentDate = lastPayMap.get(row.familyId) ?? null
      const daysOverdue = resolveDaysOverdue(
        {
          lastPaymentDate,
          weddingDate: row.weddingDate,
          createdAt: row.createdAt,
        },
        ref,
      )

      return {
        familyId: row.familyId,
        familyName: row.familyName,
        balance: row.balance,
        amountOwed: Math.abs(row.balance),
        lastPaymentDate,
        daysOverdue,
      }
    })
    .sort((a, b) => b.amountOwed - a.amountOwed)

  const aging = computeAgingBuckets(items)
  const limitedItems =
    previewLimit != null && previewLimit >= 0 ? items.slice(0, previewLimit) : items

  return {
    count: items.length,
    items: limitedItems,
    aging,
  }
}

const collectionsQuery = z.object({
  aging: z.enum(['all', '30', '60', '90']).optional().default('all'),
})

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  query: collectionsQuery,
  name: 'GET /api/collections',
  fn: async ({ ctx, query, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'collections',
      { limit: 60, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const summary = await loadDelinquencySummary(ctx!.organizationId)
    const agingFilter = query.aging === 'all' ? 'all' : (Number(query.aging) as AgingBucket)
    const items = filterByAgingBucket(summary.items, agingFilter)

    return {
      data: {
        count: summary.count,
        items,
        aging: summary.aging,
        agingFilter: query.aging,
      },
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=300' },
    }
  },
})
