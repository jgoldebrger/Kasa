import { handler } from '@/lib/api/handler'
import { checkRateLimit } from '@/lib/rate-limit'
import {
  processRecurringPaymentsForOrg,
  RecurringBillingGateError,
} from '@/lib/recurring-payments/process-org'
import {
  listRecurringPaymentsForOrg,
  validateRecurringFamilyFilter,
} from '@/lib/route-logic/recurring-payments/list'

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

    if (familyId) {
      const check = await validateRecurringFamilyFilter(ctx!.organizationId, familyId)
      if (!check.ok) {
        return { status: check.status, data: { error: check.error } }
      }
    }

    const { recurringPayments } = await listRecurringPaymentsForOrg(ctx!.organizationId, {
      familyId: familyId ?? undefined,
      activeOnly,
    })

    return { data: recurringPayments }
  },
})
