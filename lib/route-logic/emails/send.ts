import { Family } from '@/lib/models'
import { sendEmail } from '@/lib/mail'
import { checkRateLimit } from '@/lib/rate-limit'
import { email as emailSchemas } from '@/lib/schemas'
import { handler } from '@/lib/api/handler'

export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  body: emailSchemas.sendEmailBody,
  name: 'POST /api/emails/send',
  fn: async ({ ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'email-send',
      { limit: 60, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    let to = body.to?.trim()
    let familyId = body.familyId

    if (familyId) {
      const family = await Family.findOne({
        _id: familyId,
        organizationId: ctx!.organizationId,
      })
      if (!family) return { status: 404, data: { error: 'Family not found' } }
      if (!body.transactional && family.emailOptOut) {
        return { status: 400, data: { error: 'Family has opted out of bulk emails' } }
      }
      if (!family.email) {
        return { status: 400, data: { error: 'Family has no email on file' } }
      }
      to = family.email
      familyId = String(family._id)
    }

    if (!to) {
      return { status: 400, data: { error: 'Recipient email or familyId is required' } }
    }

    const result = await sendEmail({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      familyId: familyId ?? null,
      to,
      subject: body.subject,
      html: body.html,
      text: body.text,
      kind: 'custom',
      tracking: { opens: true, clicks: true },
      auditRequest: request,
    })

    if (!result.ok) {
      return { status: 500, data: { error: result.error || 'Failed to send email' } }
    }

    return { data: { ok: true, emailMessageId: result.emailMessageId } }
  },
})
