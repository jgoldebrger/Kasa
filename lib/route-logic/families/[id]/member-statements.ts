import { Types } from 'mongoose'
import { z } from 'zod'
import { handler } from '@/lib/api/handler'
import { Statement } from '@/lib/models'
import { checkMemberFamilyFinancialAccess } from '@/lib/member-family-access.server'
import { checkRateLimit } from '@/lib/rate-limit'

const MEMBER_STATEMENT_MONTHS = 12
const CACHE_HEADERS = { 'Cache-Control': 'private, max-age=15' }

const statementsQuery = z.object({
  months: z.coerce.number().int().min(1).max(24).optional(),
})

/** GET /api/families/[id]/member-statements — read-only for email-linked members. */
export const GET = handler({
  auth: 'org',
  idParams: ['id'],
  query: statementsQuery,
  name: 'GET /api/families/[id]/member-statements',
  fn: async ({ params, ctx, request, query }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'member-statements',
      { limit: 60, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const familyId = params.id as string
    if (!Types.ObjectId.isValid(familyId)) {
      return { status: 400, data: { error: 'Invalid family id' } }
    }

    const access = await checkMemberFamilyFinancialAccess(
      ctx!.organizationId,
      familyId,
      ctx!.userId,
      ctx!.role,
    )
    if (!access.allowed) {
      return { status: 403, data: { error: 'Financial access denied for this family' } }
    }

    const months = query.months ?? MEMBER_STATEMENT_MONTHS
    const since = new Date()
    since.setMonth(since.getMonth() - months)

    const statements = await Statement.find({
      organizationId: ctx!.organizationId,
      familyId,
      date: { $gte: since },
    })
      .select(
        '_id familyId statementNumber date fromDate toDate openingBalance income withdrawals expenses cycleCharges closingBalance',
      )
      .sort({ date: -1, _id: -1 })
      .limit(50)
      .lean<any[]>()

    return {
      data: { statements },
      headers: CACHE_HEADERS,
    }
  },
})
