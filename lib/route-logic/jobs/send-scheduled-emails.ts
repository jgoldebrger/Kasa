import { Family, ScheduledEmail } from '@/lib/models'
import {
  sendEmail,
  applyMergeFields,
  loadMergeFieldContext,
  delayBetweenSendsMs,
  sleep,
} from '@/lib/mail'
import { escapeHtml } from '@/lib/html-escape'
import { handler } from '@/lib/api/handler'
import { checkRateLimit } from '@/lib/rate-limit'
import { logError } from '@/lib/log'

const JOB_NAME = 'send-scheduled-emails'
const BATCH_LIMIT = 20

export const POST = handler({
  auth: 'cron',
  cronJobName: JOB_NAME,
  name: 'POST /api/jobs/send-scheduled-emails',
  fn: async ({ request }) => {
    const rateVerdict = await checkRateLimit(request, 'cron-send-scheduled-emails', {
      limit: 10,
      windowMs: 60 * 60_000,
    })
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const now = new Date()
    const due = await ScheduledEmail.find({
      status: 'pending',
      scheduledFor: { $lte: now },
    })
      .sort({ scheduledFor: 1 })
      .limit(BATCH_LIMIT)
      .lean<any[]>()

    let processed = 0
    let sent = 0
    let failed = 0

    for (const job of due) {
      processed++
      const orgId = String(job.organizationId)
      const familyIds = (job.familyIds ?? []).map(String)
      const families = await Family.find({
        organizationId: orgId,
        _id: { $in: familyIds },
      }).lean<any[]>()
      const byId = new Map(families.map((f) => [String(f._id), f]))

      const pacingMs = delayBetweenSendsMs(familyIds.length)
      let sendIndex = 0
      const errors: string[] = []

      for (const familyId of familyIds) {
        if (sendIndex > 0 && pacingMs > 0) await sleep(pacingMs)
        sendIndex++

        const family = byId.get(familyId)
        if (!family) {
          errors.push(`Family ${familyId}: not found`)
          continue
        }
        if (family.communicationsOptOut) {
          errors.push(`${family.name}: opted out`)
          continue
        }
        if (!family.email) {
          errors.push(`${family.name}: no email`)
          continue
        }

        const mergeCtx = await loadMergeFieldContext(familyId, orgId)
        const html = applyMergeFields(job.html, mergeCtx).replace(
          /\{\{familyName\}\}/g,
          escapeHtml(family.name || ''),
        )
        const text = job.text
          ? applyMergeFields(job.text, mergeCtx).replace(/\{\{familyName\}\}/g, family.name || '')
          : undefined

        const subject = applyMergeFields(job.subject, mergeCtx)

        const result = await sendEmail({
          organizationId: orgId,
          familyId,
          to: family.email,
          subject,
          html,
          text,
          kind: 'custom',
          tracking: { opens: true, clicks: true },
        })

        if (result.ok) sent++
        else errors.push(`${family.name}: ${result.error || 'send failed'}`)
      }

      const jobFailed = errors.length > 0 && sent === 0
      await ScheduledEmail.updateOne(
        { _id: job._id },
        {
          $set: {
            status: jobFailed ? 'failed' : 'sent',
            sentAt: new Date(),
            error: errors.length ? errors.join('; ').slice(0, 2000) : null,
          },
        },
      )
      if (jobFailed) {
        failed++
        logError(new Error(errors.join('; ')), {
          module: 'jobs.send-scheduled-emails',
          organizationId: orgId,
          scheduledEmailId: String(job._id),
        })
      }
    }

    return { data: { ok: true, processed, sent, failed } }
  },
})

export const GET = POST
