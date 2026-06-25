import { Types } from 'mongoose'
import { EmailDraft } from '@/lib/models'
import { checkRateLimit } from '@/lib/rate-limit'
import { emailDraft as emailDraftSchemas } from '@/lib/schemas'
import { handler } from '@/lib/api/handler'

export const dynamic = 'force-dynamic'

export const PATCH = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  body: emailDraftSchemas.emailDraftUpdateBody,
  name: 'PATCH /api/email-drafts/[id]',
  fn: async ({ ctx, params, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'email-drafts-update',
      { limit: 60, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const id = params.id as string
    if (!Types.ObjectId.isValid(id)) {
      return { status: 400, data: { error: 'Invalid draft id' } }
    }

    const updated = await EmailDraft.findOneAndUpdate(
      { _id: id, organizationId: ctx!.organizationId, userId: ctx!.userId },
      { $set: body },
      { new: true, runValidators: true },
    ).lean<any>()

    if (!updated) return { status: 404, data: { error: 'Draft not found' } }

    return {
      data: {
        _id: String(updated._id),
        subject: updated.subject ?? '',
        body: updated.body ?? '',
        html: updated.html ?? '',
        selectedFamilyIds: (updated.selectedFamilyIds ?? []).map(String),
      },
    }
  },
})

export const DELETE = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  name: 'DELETE /api/email-drafts/[id]',
  fn: async ({ ctx, params, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'email-drafts-delete',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const id = params.id as string
    if (!Types.ObjectId.isValid(id)) {
      return { status: 400, data: { error: 'Invalid draft id' } }
    }

    const deleted = await EmailDraft.findOneAndDelete({
      _id: id,
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
    })
    if (!deleted) return { status: 404, data: { error: 'Draft not found' } }

    return { data: { ok: true } }
  },
})
