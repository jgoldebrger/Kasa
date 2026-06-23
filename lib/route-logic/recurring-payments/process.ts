import { Types } from 'mongoose'
import { handler } from '@/lib/api/handler'
import { Family, RecurringPayment } from '@/lib/models'
import { collectCompoundCursorPages } from '@/lib/pagination'
import { checkRateLimit } from '@/lib/rate-limit'
import {
  processRecurringPaymentsForOrg,
  RecurringBillingGateError,
} from '@/lib/recurring-payments/process-org'

// POST - Process all due recurring payments for one organization.
// Accepts an admin session OR a cron secret + ?organizationId=<id>.
export const POST = handler({
  auth: 'org-or-cron',
  minRole: 'admin',
  name: 'POST /api/recurring-payments/process',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'recurring-process',
      {
        limit: 5,
        windowMs: 60_000,
      },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    try {
      const data = await processRecurringPaymentsForOrg(ctx!.organizationId)
      return { data }
    } catch (err) {
      if (err instanceof RecurringBillingGateError) {
        return { status: err.status, data: { error: err.message } }
      }
      throw err
    }
  },
})

// GET - Get all recurring payments
export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/recurring-payments/process',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'recurring-payments-list',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const searchParams = request.nextUrl.searchParams
    const familyId = searchParams.get('familyId')
    const activeOnly = searchParams.get('activeOnly') !== 'false'

    const query: any = { organizationId: ctx!.organizationId }
    if (familyId) {
      if (!Types.ObjectId.isValid(familyId)) {
        return { status: 400, data: { error: 'Invalid familyId' } }
      }
      const fam = await Family.findOne({
        _id: familyId,
        organizationId: ctx!.organizationId,
      }).select('_id')
      if (!fam) {
        return { status: 404, data: { error: 'Family not found' } }
      }
      query.familyId = familyId
    }
    if (activeOnly) query.isActive = true

    const recurringPayments = await collectCompoundCursorPages<{
      _id: unknown
      nextPaymentDate?: string | Date | null
    }>(
      (filter, limit) =>
        RecurringPayment.find(filter)
          .populate({
            path: 'familyId',
            select: 'name email organizationId deletedAt',
            match: { organizationId: ctx!.organizationId },
            options: { includeDeleted: true },
          })
          .populate({
            path: 'savedPaymentMethodId',
            select:
              'last4 cardType expiryMonth expiryYear nameOnCard isDefault isActive organizationId legacyPlatformAccount',
            match: { organizationId: ctx!.organizationId },
          })
          .sort({ nextPaymentDate: 1, _id: 1 })
          .limit(limit)
          .exec() as Promise<Array<{ _id: unknown; nextPaymentDate?: string | Date | null }>>,
      query,
      'nextPaymentDate',
      1,
      (last) => ({
        v: last.nextPaymentDate ? new Date(last.nextPaymentDate as string | Date).getTime() : null,
        id: String(last._id),
      }),
    )

    return { data: recurringPayments }
  },
})
