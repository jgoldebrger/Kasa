import { Family } from '@/lib/models'
import { sendEmail, applyMergeFields, loadMergeFieldContext } from '@/lib/mail'
import { escapeHtml } from '@/lib/html-escape'
import { checkRateLimit } from '@/lib/rate-limit'
import { email as emailSchemas } from '@/lib/schemas'
import { handler } from '@/lib/api/handler'

export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  body: emailSchemas.testSendEmailBody,
  name: 'POST /api/emails/test-send',
  fn: async ({ ctx, body, session, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'email-test-send',
      { limit: 20, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const to = session?.user.email?.trim()
    if (!to) {
      return { status: 400, data: { error: 'Your account has no email address' } }
    }

    let html = body.html ?? ''
    let text = body.text
    let subject = body.subject

    const familyId = body.selectedFamilyIds?.[0]
    if (familyId) {
      const family = await Family.findOne({
        _id: familyId,
        organizationId: ctx!.organizationId,
      }).lean<{ _id: unknown; name?: string }>()
      if (family) {
        const mergeCtx = await loadMergeFieldContext(String(family._id), ctx!.organizationId)
        subject = applyMergeFields(subject, mergeCtx)
        html = applyMergeFields(html, mergeCtx).replace(
          /\{\{familyName\}\}/g,
          escapeHtml(family.name || ''),
        )
        if (text) {
          text = applyMergeFields(text, mergeCtx).replace(/\{\{familyName\}\}/g, family.name || '')
        }
      }
    }

    const result = await sendEmail({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      familyId: familyId ?? null,
      to,
      subject,
      html,
      text,
      kind: 'custom',
      tracking: { opens: false, clicks: false },
      auditRequest: request,
    })

    if (!result.ok) {
      return { status: 500, data: { error: result.error || 'Failed to send test email' } }
    }

    return { data: { ok: true, emailMessageId: result.emailMessageId } }
  },
})
