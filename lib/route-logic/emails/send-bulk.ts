import { Family } from '@/lib/models'
import { sendEmail } from '@/lib/mail'
import { escapeHtml } from '@/lib/html-escape'
import { checkRateLimit } from '@/lib/rate-limit'
import { email as emailSchemas } from '@/lib/schemas'
import { handler } from '@/lib/api/handler'

export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  body: emailSchemas.sendBulkEmailBody,
  name: 'POST /api/emails/send-bulk',
  fn: async ({ ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'email-send-bulk',
      { limit: 10, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const families = await Family.find({
      organizationId: ctx!.organizationId,
      _id: { $in: body.familyIds },
    }).lean<any[]>()

    const byId = new Map(families.map((f) => [String(f._id), f]))
    const results = { sent: 0, failed: 0, errors: [] as string[] }

    for (const id of body.familyIds) {
      const family = byId.get(id)
      if (!family) {
        results.failed++
        results.errors.push(`Family ${id}: not found`)
        continue
      }
      if (!body.transactional && family.emailOptOut) {
        results.failed++
        results.errors.push(`${family.name}: opted out`)
        continue
      }
      if (!family.email) {
        results.failed++
        results.errors.push(`${family.name}: no email on file`)
        continue
      }

      const html = body.html.replace(/\{\{familyName\}\}/g, escapeHtml(family.name || ''))
      const text = body.text?.replace(/\{\{familyName\}\}/g, family.name || '')

      const result = await sendEmail({
        organizationId: ctx!.organizationId,
        userId: ctx!.userId,
        familyId: String(family._id),
        to: family.email,
        subject: body.subject,
        html,
        text,
        kind: 'custom',
        tracking: { opens: true, clicks: true },
        auditRequest: request,
      })

      if (result.ok) results.sent++
      else {
        results.failed++
        results.errors.push(`${family.name}: ${result.error || 'send failed'}`)
      }
    }

    return { data: results }
  },
})
