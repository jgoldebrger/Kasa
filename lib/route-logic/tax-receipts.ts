/**
 * Year-end tax receipt list.
 *
 * GET /api/tax-receipts?year=YYYY — admin-only. Returns one row per
 * family in the active org with their membership-dues total + a
 * breakdown of contributing payments inside the calendar year.
 *
 * Scope: membership dues only. Lifecycle event payments live in
 * `LifecycleEventPayment`, so a plain `Payment.find` over the calendar
 * year naturally excludes them. CycleCharges are charges (debits) not
 * gifts, so they're also excluded.
 *
 * The return shape is what the Tax Receipts tab in `StatementsView`
 * needs to drive the preview table + the three bulk actions, and what
 * the per-family PDF endpoint reuses to render the receipt body.
 */

import { z } from 'zod'
import { handler } from '@/lib/api/handler'
import { Payment } from '@/lib/models'
import { yearParam } from '@/lib/schemas'
import { membershipDuesYearFilter, netMembershipPaymentAmount } from '@/lib/tax-receipts/queries'
import { checkRateLimit } from '@/lib/rate-limit'
import { loadAllByIdCursor, familyBatches } from '@/lib/org-pagination'

export const dynamic = 'force-dynamic'

const query = z.object({
  year: yearParam,
})

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  query,
  name: 'GET /api/tax-receipts',
  fn: async ({ ctx, query, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'tax-receipts-list',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const year = query.year

    // Year membership via `Payment.year` (org-timezone-stamped at charge
    // time) with a paymentDate fallback for legacy rows — NOT a UTC
    // calendar-year window on paymentDate alone.
    const paymentFilter = await membershipDuesYearFilter(year, String(ctx!.organizationId))
    const payments = await loadAllByIdCursor<any>(
      (filter, limit) =>
        Payment.find(filter)
          .select('familyId amount refundedAmount paymentDate paymentMethod notes')
          .sort({ _id: 1 })
          .limit(limit)
          .lean<any[]>(),
      paymentFilter,
    )

    if (payments.length === 0) {
      return { data: [] }
    }

    const byFamily = new Map<
      string,
      {
        totalPaid: number
        payments: { date: string; method: string; amount: number; notes: string }[]
      }
    >()
    for (const p of payments) {
      const amt = netMembershipPaymentAmount(p)
      if (amt <= 0) continue
      const fid = String(p.familyId)
      let bucket = byFamily.get(fid)
      if (!bucket) {
        bucket = { totalPaid: 0, payments: [] }
        byFamily.set(fid, bucket)
      }
      bucket.totalPaid += amt
      bucket.payments.push({
        date: new Date(p.paymentDate).toISOString(),
        method: String(p.paymentMethod || 'cash'),
        amount: amt,
        notes: String(p.notes || ''),
      })
    }

    const familyById = new Map<string, any>()
    for await (const batch of familyBatches(String(ctx!.organizationId), {
      select: 'name street city state zip email emailOptOut',
    })) {
      for (const fam of batch) {
        const id = String(fam._id)
        if (byFamily.has(id)) familyById.set(id, fam)
      }
    }

    const items = Array.from(familyById.entries())
      .map(([fid, f]) => {
        const bucket = byFamily.get(fid)
        if (!bucket || bucket.totalPaid === 0) return null
        return {
          familyId: fid,
          familyName: (f as any).name || '',
          address: {
            street: (f as any).street || '',
            city: (f as any).city || '',
            state: (f as any).state || '',
            zip: (f as any).zip || '',
          },
          email: (f as any).email || '',
          emailOptOut: !!(f as any).emailOptOut,
          totalPaid: bucket.totalPaid,
          payments: bucket.payments,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.familyName.localeCompare(b.familyName))

    return { data: items }
  },
})
