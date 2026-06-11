import { Types } from 'mongoose'
import { Withdrawal, Family } from '@/lib/models'
import { audit } from '@/lib/audit'
import { handler } from '@/lib/api/handler'
import { z } from 'zod'
import { isoDate, moneyAmount, optionalString } from '@/lib/schemas'
import { checkRateLimit } from '@/lib/rate-limit'

const updateBody = z
  .object({
    amount: moneyAmount.gt(0, 'Amount must be greater than 0'),
    withdrawalDate: isoDate,
    reason: optionalString(500),
    notes: optionalString(2000),
  })
  .partial()

// PUT /api/families/[id]/withdrawals/[withdrawalId] — edit a withdrawal.
export const PUT = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id', 'withdrawalId'],
  body: updateBody,
  name: 'PUT /api/families/[id]/withdrawals/[withdrawalId]',
  fn: async ({ params, ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'family-withdrawal-update',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const familyId = params.id as string
    const withdrawalId = params.withdrawalId as string
    /* v8 ignore next 3 -- idParams validates ObjectIds before fn */
    if (!Types.ObjectId.isValid(familyId) || !Types.ObjectId.isValid(withdrawalId)) {
      return { status: 400, data: { error: 'Invalid family or withdrawal id' } }
    }

    const fam = await Family.findOne({
      _id: familyId,
      organizationId: ctx!.organizationId,
    }).select('_id')
    if (!fam) return { status: 404, data: { error: 'Family not found' } }

    if (Object.keys(body).length === 0) {
      return { status: 400, data: { error: 'No fields to update' } }
    }

    const updated = await Withdrawal.findOneAndUpdate(
      {
        _id: withdrawalId,
        familyId,
        organizationId: ctx!.organizationId,
      },
      { $set: body },
      { new: true, runValidators: true },
    )
    if (!updated) return { status: 404, data: { error: 'Withdrawal not found' } }

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'withdrawal.update',
      resourceType: 'Withdrawal',
      resourceId: updated._id,
      metadata: { familyId, fields: Object.keys(body) },
      request,
    })

    return { data: updated.toObject() }
  },
})

// DELETE /api/families/[id]/withdrawals/[withdrawalId] — soft-delete a
// withdrawal. Withdrawals now participate in the recycle bin so a family
// cascade restore keeps them in sync.
export const DELETE = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id', 'withdrawalId'],
  name: 'DELETE /api/families/[id]/withdrawals/[withdrawalId]',
  fn: async ({ params, ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'family-withdrawal-delete',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const familyId = params.id as string
    const withdrawalId = params.withdrawalId as string
    /* v8 ignore next 3 -- idParams validates ObjectIds before fn */
    if (!Types.ObjectId.isValid(familyId) || !Types.ObjectId.isValid(withdrawalId)) {
      return { status: 400, data: { error: 'Invalid family or withdrawal id' } }
    }

    const fam = await Family.findOne({
      _id: familyId,
      organizationId: ctx!.organizationId,
    }).select('_id')
    if (!fam) return { status: 404, data: { error: 'Family not found' } }

    // Use the soft-delete plugin's update path so the row is hidden by
    // default queries but stays recoverable from the recycle bin.
    const deleted = await Withdrawal.findOneAndUpdate(
      {
        _id: withdrawalId,
        familyId,
        organizationId: ctx!.organizationId,
      },
      { $set: { deletedAt: new Date(), deletedBy: ctx!.userId } },
      { new: true },
    )
    if (!deleted) return { status: 404, data: { error: 'Withdrawal not found' } }

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'withdrawal.delete',
      resourceType: 'Withdrawal',
      resourceId: (deleted as any)._id,
      metadata: { familyId, amount: (deleted as any).amount },
      request,
    })

    return { data: { ok: true } }
  },
})
