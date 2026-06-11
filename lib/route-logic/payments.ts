import { Payment, Organization, Family } from '@/lib/models'
import { handler } from '@/lib/api/handler'
import { buildPaymentYearFilter } from '@/lib/calculations'
import { z } from 'zod'
import { objectId, paginationLimit, UNBOUNDED_LIST_CAP, yearParam } from '@/lib/schemas'
import {
  compoundCursorFilter,
  decodeCompoundCursor,
  encodeCompoundCursor,
  collectCompoundCursorPages,
} from '@/lib/pagination'
import { PAYMENT_PUBLIC_SELECT } from '@/lib/payments/select'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const listQuery = z.object({
  familyId: objectId.optional(),
  year: yearParam.optional(),
  paymentMethod: z.enum(['cash', 'credit_card', 'check', 'quick_pay']).optional(),
  type: z.string().trim().max(60).optional(),
  limit: paginationLimit,
  // Compound cursor — opaque to the client. The base64-url string encodes
  // the trailing row's `(paymentDate, _id)` pair so we can resume the
  // (paymentDate desc, _id desc) walk without skipping rows that share
  // a paymentDate.
  cursor: z.string().min(1).max(400).optional(),
})

// GET /api/payments — list payments for the active org, optionally filtered.
// Admin-only: exposes org-wide ledger data (amounts, families, card last4).
export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  query: listQuery,
  name: 'GET /api/payments',
  fn: async ({ ctx, query, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'payments-list',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    let filter: Record<string, unknown> = { organizationId: ctx!.organizationId }
    if (query.year !== undefined) {
      const org = await Organization.findById(ctx!.organizationId)
        .select('timezone')
        .lean<{ timezone?: string }>()
      filter = {
        ...buildPaymentYearFilter(query.year, ctx!.organizationId, org?.timezone),
      }
    }
    if (query.familyId) {
      const fam = await Family.findOne({
        _id: query.familyId,
        organizationId: ctx!.organizationId,
      }).select('_id')
      if (!fam) return { status: 404, data: { error: 'Family not found' } }
      filter.familyId = query.familyId
    }
    if (query.paymentMethod) filter.paymentMethod = query.paymentMethod
    if (query.type) filter.type = query.type

    if (query.cursor) {
      const c = decodeCompoundCursor(query.cursor)
      if (!c) {
        return { status: 400, data: { error: 'Invalid cursor' } }
      }
      const cursorDate = c.v === null ? null : new Date(c.v as number)
      Object.assign(filter, compoundCursorFilter('paymentDate', cursorDate, c.id, -1))
    }

    // Two modes:
    //   - Caller passed `?limit=` -> paginated envelope with cursor.
    //   - Caller omitted it       -> legacy flat array, but BOUNDED at
    //     UNBOUNDED_LIST_CAP so a single request can't pull the entire
    //     org's payment history.
    const clientLimit = query.limit ?? 0
    const effectiveLimit = clientLimit > 0 ? clientLimit : UNBOUNDED_LIST_CAP

    const loadPaymentPage = async (pageFilter: Record<string, unknown>, limit: number) =>
      (await Payment.find(pageFilter)
        .select(PAYMENT_PUBLIC_SELECT)
        .populate({
          path: 'familyId',
          select: 'name hebrewName email phone organizationId',
          match: { organizationId: ctx!.organizationId },
        })
        .sort({ paymentDate: -1, _id: -1 })
        .limit(limit).lean()) as any[]

    let nextCursor: string | null = null
    let data: any[]
    if (clientLimit > 0) {
      const rows = await loadPaymentPage(filter, effectiveLimit + 1)
      data = rows
      if (rows.length > effectiveLimit) {
        data = rows.slice(0, effectiveLimit)
        const last = data[data.length - 1]
        if (last) {
          nextCursor = encodeCompoundCursor({
            v: last.paymentDate ? new Date(last.paymentDate).getTime() : null,
            id: String(last._id),
          })
        }
      }
    } else {
      data = await collectCompoundCursorPages(
        loadPaymentPage,
        filter,
        'paymentDate',
        -1,
        (last) => ({
          v: last.paymentDate ? new Date(last.paymentDate as string | Date).getTime() : null,
          id: String(last._id),
        }),
      )
    }

    // Preserve the legacy shape (array) when no limit is requested; switch
    // to a paginated envelope when the client opts in via `?limit=`. In
    // the legacy path the `nextCursor` is intentionally dropped because
    // the response type is `Payment[]`, not `{ items, nextCursor }`.
    return { data: clientLimit > 0 ? { items: data, nextCursor } : data }
  },
})
