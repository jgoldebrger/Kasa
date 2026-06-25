import { Types } from 'mongoose'
import { ScheduledEmail } from '@/lib/models'
import { checkRateLimit } from '@/lib/rate-limit'
import { handler } from '@/lib/api/handler'

export const dynamic = 'force-dynamic'

export const DELETE = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  name: 'DELETE /api/scheduled-emails/[id]',
  fn: async ({ ctx, params, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'scheduled-emails-cancel',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const id = params.id as string
    if (!Types.ObjectId.isValid(id)) {
      return { status: 400, data: { error: 'Invalid scheduled email id' } }
    }

    const updated = await ScheduledEmail.findOneAndUpdate(
      { _id: id, organizationId: ctx!.organizationId, status: 'pending' },
      { $set: { status: 'cancelled' } },
      { new: true },
    ).lean<any>()

    if (!updated) {
      const exists = await ScheduledEmail.findOne({ _id: id, organizationId: ctx!.organizationId })
      if (!exists) return { status: 404, data: { error: 'Scheduled email not found' } }
      return { status: 400, data: { error: 'Only pending scheduled emails can be cancelled' } }
    }

    return { data: { ok: true, status: updated.status } }
  },
})
