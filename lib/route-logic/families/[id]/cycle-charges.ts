import { Types } from 'mongoose'
import { CycleCharge, Family } from '@/lib/models'
import { handler } from '@/lib/api/handler'
import { checkRateLimit } from '@/lib/rate-limit'
import {
  familyLedgerListQuery,
  listFamilyLedger,
} from '@/lib/family-ledger-list'

const LEDGER_CACHE_HEADERS = {
  'Cache-Control': 'private, max-age=15, stale-while-revalidate=60',
}

// GET /api/families/[id]/cycle-charges — list cycle charges for one family.
export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  query: familyLedgerListQuery,
  name: 'GET /api/families/[id]/cycle-charges',
  fn: async ({ params, ctx, request, query }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'family-cycle-charges-list',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const id = params.id as string
    if (!Types.ObjectId.isValid(id)) {
      return { status: 400, data: { error: 'Invalid family id' } }
    }

    const fam = await Family.findOne({ _id: id, organizationId: ctx!.organizationId }).select('_id')
    if (!fam) return { status: 404, data: { error: 'Family not found' } }

    const baseFilter = { familyId: id, organizationId: ctx!.organizationId }
    const loadPage = (filter: Record<string, unknown>, limit: number) =>
      CycleCharge.find(filter)
        .sort({ chargeDate: -1, _id: -1 })
        .limit(limit)
        .lean()

    const effectiveQuery = {
      limit: query.limit ?? 0,
      cursor: query.cursor,
    }

    try {
      const data = await listFamilyLedger(
        baseFilter,
        loadPage,
        'chargeDate',
        -1,
        (last) => ({
          v: last.chargeDate ? new Date(last.chargeDate as string | Date).getTime() : null,
          id: String(last._id),
        }),
        effectiveQuery,
      )
      return { data, headers: LEDGER_CACHE_HEADERS }
    } catch (err) {
      if (err instanceof Error && err.message === 'Invalid cursor') {
        return { status: 400, data: { error: 'Invalid cursor' } }
      }
      throw err
    }
  },
})
