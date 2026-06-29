import { Types } from 'mongoose'
import { handler } from '@/lib/api/handler'
import { checkRateLimit } from '@/lib/rate-limit'
import {
  listRecurringPaymentsForOrg,
  validateRecurringFamilyFilter,
} from '@/lib/route-logic/recurring-payments/list'

// GET - List active recurring payments and failed charge recovery queue.
export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/recurring-payments',
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

    const data = await listRecurringPaymentsForOrg(ctx!.organizationId, {
      familyId: familyId ?? undefined,
      activeOnly,
    })

    return { data }
  },
})
