import { z } from 'zod'
import { handler } from '@/lib/api/handler'
import { Payment, Task } from '@/lib/models'
import { checkRateLimit } from '@/lib/rate-limit'
import { PAYMENT_PUBLIC_SELECT, serializePaymentsPublic } from '@/lib/payments/select'
import { netPaymentAmount } from '@/lib/money'
import { disputeMongoFilter, type DisputeFilter } from '@/lib/payments/dispute-status'
import { paginationLimit } from '@/lib/schemas'

export const dynamic = 'force-dynamic'

const disputesQuery = z.object({
  status: z.enum(['open', 'closed', 'all']).default('open'),
  limit: paginationLimit,
})

// GET /api/payments/disputes — disputed payments with linked admin tasks.
export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  query: disputesQuery,
  name: 'GET /api/payments/disputes',
  fn: async ({ ctx, query, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'payments-disputes',
      { limit: 60, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const status = query.status as DisputeFilter
    const filter = {
      organizationId: ctx!.organizationId,
      ...disputeMongoFilter(status),
    }

    const payments = await Payment.find(filter)
      .select(PAYMENT_PUBLIC_SELECT)
      .populate({
        path: 'familyId',
        select: 'name hebrewName email phone organizationId',
        match: { organizationId: ctx!.organizationId },
      })
      .sort({ disputedAt: -1, _id: -1 })
      .limit(query.limit ?? 200)
      .lean<any[]>()

    const paymentIds = payments.map((p) => p._id)
    const tasks = paymentIds.length
      ? await Task.find({
          organizationId: ctx!.organizationId,
          relatedPaymentId: { $in: paymentIds },
        })
          .select('_id relatedPaymentId status title dueDate')
          .lean()
      : []

    const taskByPayment = new Map<string, (typeof tasks)[number]>()
    for (const task of tasks) {
      const pid = String(task.relatedPaymentId)
      if (!taskByPayment.has(pid)) taskByPayment.set(pid, task)
    }

    const items = serializePaymentsPublic(payments).map((p: any) => ({
      ...p,
      netAmount: netPaymentAmount(p),
      task: taskByPayment.get(String(p._id))
        ? {
            _id: String(taskByPayment.get(String(p._id))!._id),
            title: taskByPayment.get(String(p._id))!.title,
            status: taskByPayment.get(String(p._id))!.status,
            dueDate: taskByPayment.get(String(p._id))!.dueDate,
          }
        : null,
    }))

    const openCount = await Payment.countDocuments({
      organizationId: ctx!.organizationId,
      ...disputeMongoFilter('open'),
    })
    const closedCount = await Payment.countDocuments({
      organizationId: ctx!.organizationId,
      ...disputeMongoFilter('closed'),
    })

    return {
      data: {
        items,
        counts: { open: openCount, closed: closedCount, all: openCount + closedCount },
      },
    }
  },
})
