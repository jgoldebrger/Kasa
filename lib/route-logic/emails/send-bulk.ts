import { Types } from 'mongoose'
import { Family } from '@/lib/models'
import { sendEmail, applyMergeFields, delayBetweenSendsMs, sleep } from '@/lib/mail'
import { escapeHtml } from '@/lib/html-escape'
import { calculateFamilyBalance } from '@/lib/calculations'
import { checkRateLimit } from '@/lib/rate-limit'
import { email as emailSchemas } from '@/lib/schemas'
import { handler } from '@/lib/api/handler'

function parseAttachments(
  attachments?: { filename: string; contentBase64: string; contentType?: string }[],
) {
  return attachments?.map((a) => ({
    filename: a.filename,
    content: Buffer.from(a.contentBase64, 'base64'),
    contentType: a.contentType,
  }))
}

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
    const campaignId = new Types.ObjectId()
    const pacingMs = delayBetweenSendsMs(body.familyIds.length)
    const attachments = parseAttachments(body.attachments)
    let sendIndex = 0

    for (const id of body.familyIds) {
      if (sendIndex > 0 && pacingMs > 0) {
        await sleep(pacingMs)
      }
      sendIndex++

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

      let balance: number | undefined
      let dues: number | undefined
      try {
        const bal = await calculateFamilyBalance(String(family._id), ctx!.organizationId)
        balance = bal.balance
        dues = bal.planCost
      } catch {
        balance = 0
        dues = 0
      }

      const mergeCtx = {
        familyName: family.name || '',
        balance,
        dues,
      }
      const html = applyMergeFields(body.html, mergeCtx).replace(
        /\{\{familyName\}\}/g,
        escapeHtml(family.name || ''),
      )
      const text = body.text
        ? applyMergeFields(body.text, mergeCtx).replace(/\{\{familyName\}\}/g, family.name || '')
        : undefined

      const result = await sendEmail({
        organizationId: ctx!.organizationId,
        userId: ctx!.userId,
        familyId: String(family._id),
        to: family.email,
        subject: body.subject,
        html,
        text,
        attachments,
        kind: 'custom',
        campaignId: String(campaignId),
        tracking: { opens: true, clicks: true },
        auditRequest: request,
      })

      if (result.ok) results.sent++
      else {
        results.failed++
        results.errors.push(`${family.name}: ${result.error || 'send failed'}`)
      }
    }

    return { data: { ...results, campaignId: String(campaignId) } }
  },
})
