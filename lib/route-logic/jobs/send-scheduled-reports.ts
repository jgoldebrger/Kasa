import { SavedReport, ScheduledReport } from '@/lib/models'
import { handler } from '@/lib/api/handler'
import { checkRateLimit } from '@/lib/rate-limit'
import { runReport } from '@/lib/report-builder'
import { formatReportResultHtml } from '@/lib/reports/format-report-email'
import { computeNextRunAt } from '@/lib/reports/scheduled-report-utils'
import { sendEmail } from '@/lib/mail'
import { loadOrgEmailConfig } from '@/lib/mail/load-org-email-config'
import { logError } from '@/lib/log'

const JOB_NAME = 'send-scheduled-reports'
const BATCH_LIMIT = 10

export const POST = handler({
  auth: 'cron',
  cronJobName: JOB_NAME,
  name: 'POST /api/jobs/send-scheduled-reports',
  fn: async ({ request }) => {
    const rateVerdict = await checkRateLimit(request, 'cron-send-scheduled-reports', {
      limit: 10,
      windowMs: 60 * 60_000,
    })
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const now = new Date()
    const due = await ScheduledReport.find({
      enabled: true,
      nextRunAt: { $lte: now },
    })
      .sort({ nextRunAt: 1 })
      .limit(BATCH_LIMIT)
      .lean<any[]>()

    let processed = 0
    let sent = 0
    let failed = 0

    for (const schedule of due) {
      processed++
      const orgId = String(schedule.organizationId)
      const savedReportId = String(schedule.savedReportId)

      try {
        const saved = await SavedReport.findOne({
          _id: savedReportId,
          organizationId: orgId,
        }).lean<any>()
        if (!saved) {
          await ScheduledReport.updateOne(
            { _id: schedule._id },
            {
              $set: {
                lastError: 'Saved report not found',
                lastRunAt: now,
                nextRunAt: computeNextRunAt(schedule.frequency, now),
              },
            },
          )
          failed++
          continue
        }

        const emailCfg = await loadOrgEmailConfig(orgId)
        if (!emailCfg.ok) {
          await ScheduledReport.updateOne(
            { _id: schedule._id },
            {
              $set: {
                lastError: emailCfg.error,
                lastRunAt: now,
                nextRunAt: computeNextRunAt(schedule.frequency, now),
              },
            },
          )
          failed++
          continue
        }

        const recipient = schedule.recipientEmail?.trim() || emailCfg.config.email
        const config = saved.config || {}
        const result = await runReport(
          {
            source: saved.source,
            rowDim: config.rowDim,
            colDim: config.colDim,
            measure: config.measure,
            aggregate: config.aggregate || 'count',
            fromDate: config.fromDate,
            toDate: config.toDate,
          },
          orgId,
        )

        const html = formatReportResultHtml(saved.name, result, { generatedAt: now })
        const freqLabel = schedule.frequency === 'weekly' ? 'Weekly' : 'Monthly'
        const subject = `${freqLabel} report: ${saved.name}`

        const sendResult = await sendEmail({
          organizationId: orgId,
          to: recipient,
          subject,
          html,
          kind: 'custom',
          config: emailCfg.config,
        })

        if (!sendResult.ok) {
          await ScheduledReport.updateOne(
            { _id: schedule._id },
            {
              $set: {
                lastError: sendResult.error || 'Send failed',
                lastRunAt: now,
                nextRunAt: computeNextRunAt(schedule.frequency, now),
              },
            },
          )
          failed++
          logError(new Error(sendResult.error || 'Scheduled report send failed'), {
            module: 'jobs.send-scheduled-reports',
            organizationId: orgId,
            scheduleId: String(schedule._id),
          })
          continue
        }

        await ScheduledReport.updateOne(
          { _id: schedule._id },
          {
            $set: {
              lastRunAt: now,
              nextRunAt: computeNextRunAt(schedule.frequency, now),
              lastError: null,
            },
          },
        )
        sent++
      } catch (err) {
        failed++
        const message = err instanceof Error ? err.message : String(err)
        await ScheduledReport.updateOne(
          { _id: schedule._id },
          {
            $set: {
              lastError: message.slice(0, 2000),
              lastRunAt: now,
              nextRunAt: computeNextRunAt(schedule.frequency, now),
            },
          },
        )
        logError(err, {
          module: 'jobs.send-scheduled-reports',
          organizationId: orgId,
          scheduleId: String(schedule._id),
        })
      }
    }

    return { data: { ok: true, processed, sent, failed } }
  },
})

export const GET = POST
