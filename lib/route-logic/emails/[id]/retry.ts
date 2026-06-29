import { Types } from 'mongoose'
import { EmailMessage } from '@/lib/models'
import { sendEmail } from '@/lib/mail'
import { checkRateLimit } from '@/lib/rate-limit'
import { handler } from '@/lib/api/handler'

export const dynamic = 'force-dynamic'

export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  name: 'POST /api/emails/[id]/retry',
  fn: async ({ ctx, params, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'email-retry',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const id = params.id as string
    if (!Types.ObjectId.isValid(id)) {
      return { status: 400, data: { error: 'Invalid email id' } }
    }

    const row = await EmailMessage.findOne({
      _id: id,
      organizationId: ctx!.organizationId,
    }).lean<any>()

    if (!row) return { status: 404, data: { error: 'Email not found' } }
    if (row.status !== 'failed' && row.status !== 'bounced') {
      return { status: 400, data: { error: 'Only failed or bounced emails can be retried' } }
    }
    if (!row.html?.trim() && !row.text?.trim()) {
      return {
        status: 400,
        data: {
          error: 'Email content is not available for retry',
          code: 'EMAIL_CONTENT_UNAVAILABLE',
        },
      }
    }

    const result = await sendEmail({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      familyId: row.familyId ? String(row.familyId) : null,
      to: row.to,
      subject: row.subject,
      html: row.html,
      text: row.text,
      kind: row.kind,
      campaignId: row.campaignId ? String(row.campaignId) : undefined,
      tracking: { opens: row.openTracking, clicks: row.clickTracking },
      auditRequest: request,
    })

    if (!result.ok) {
      return { status: 500, data: { error: result.error || 'Retry failed' } }
    }

    return { data: { ok: true, emailMessageId: result.emailMessageId } }
  },
})
