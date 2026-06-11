import { Types } from 'mongoose'
import { Withdrawal, Family } from '@/lib/models'
import { audit } from '@/lib/audit'
import { handler } from '@/lib/api/handler'
import { z } from 'zod'
import { isoDate, moneyAmount, optionalString, UNBOUNDED_LIST_CAP } from '@/lib/schemas'
import { collectCompoundCursorPages } from '@/lib/pagination'
import { checkRateLimit } from '@/lib/rate-limit'

// GET /api/families/[id]/withdrawals — list withdrawals for one family.
export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  name: 'GET /api/families/[id]/withdrawals',
  fn: async ({ params, ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'family-withdrawals-list',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const id = params.id as string
    /* v8 ignore next 3 -- idParams validates ObjectId before fn */
    if (!Types.ObjectId.isValid(id)) {
      return { status: 400, data: { error: 'Invalid family id' } }
    }
    const fam = await Family.findOne({ _id: id, organizationId: ctx!.organizationId }).select('_id')
    if (!fam) return { status: 404, data: { error: 'Family not found' } }
    const withdrawals = await collectCompoundCursorPages(
      (filter, limit) =>
        Withdrawal.find(filter)
          .sort({ withdrawalDate: -1, _id: -1 })
          .limit(limit).lean(),
      { familyId: id, organizationId: ctx!.organizationId },
      'withdrawalDate',
      -1,
      (last) => ({
        v: last.withdrawalDate
          ? new Date(last.withdrawalDate as string | Date).getTime()
          : null,
        id: String(last._id),
      }),
    )
    return { data: withdrawals }
  },
})

const createBody = z.object({
  amount: moneyAmount.gt(0, 'Amount must be greater than 0'),
  withdrawalDate: isoDate,
  reason: optionalString(500),
  notes: optionalString(2000),
})

// POST /api/families/[id]/withdrawals — record a withdrawal.
// Admin-only: writes money out of the ledger.
export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  body: createBody,
  name: 'POST /api/families/[id]/withdrawals',
  fn: async ({ params, ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'family-withdrawal-create',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const id = params.id as string
    /* v8 ignore next 3 -- idParams validates ObjectId before fn */
    if (!Types.ObjectId.isValid(id)) {
      return { status: 400, data: { error: 'Invalid family id' } }
    }

    // Tenant guard: confirm the family belongs to caller's org before
    // creating a row that would otherwise be silently orphaned.
    const fam = await Family.findOne({
      _id: id,
      organizationId: ctx!.organizationId,
    }).select('_id')
    if (!fam) return { status: 404, data: { error: 'Family not found' } }

    const withdrawal = await Withdrawal.create({
      organizationId: ctx!.organizationId,
      familyId: id,
      amount: body.amount,
      withdrawalDate: body.withdrawalDate,
      reason: body.reason,
      notes: body.notes,
    })

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'withdrawal.create',
      resourceType: 'Withdrawal',
      resourceId: withdrawal._id,
      metadata: {
        familyId: id,
        amount: body.amount,
        reason: body.reason,
      },
      request,
    })

    return { status: 201, data: withdrawal.toObject() }
  },
})
