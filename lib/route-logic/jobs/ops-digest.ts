/**
 * Daily ops digest — emails platform admins when cron jobs failed in the last 24h.
 * Cron: GET/POST /api/jobs/ops-digest (secured by CRON_SECRET).
 */

import { handler } from '@/lib/api/handler'
import { JobRun, EmailJob } from '@/lib/models'
import { sendPlatformEmail, isPlatformEmailConfigured } from '@/lib/platform-email'
import { checkRateLimit } from '@/lib/rate-limit'
import { escapeHtml } from '@/lib/html-escape'

const JOB_NAME = 'ops-digest'

function getPlatformAdminEmails(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export const POST = handler({
  auth: 'cron',
  cronJobName: JOB_NAME,
  name: 'POST /api/jobs/ops-digest',
  fn: async ({ request }) => {
    const rateVerdict = await checkRateLimit(request, 'cron-ops-digest', {
      limit: 10,
      windowMs: 60 * 60_000,
    })
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)

    const [failedRuns, partialRuns, failedEmails] = await Promise.all([
      JobRun.find({ status: 'failed', startedAt: { $gte: since } })
        .sort({ startedAt: -1 })
        .limit(50)
        .lean<any[]>(),
      JobRun.find({ status: 'completed', failed: { $gt: 0 }, startedAt: { $gte: since } })
        .sort({ startedAt: -1 })
        .limit(50)
        .lean<any[]>(),
      EmailJob.find({ status: 'failed', createdAt: { $gte: since } })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean<any[]>(),
    ])

    const issueCount = failedRuns.length + partialRuns.length + failedEmails.length
    if (issueCount === 0) {
      return { data: { ok: true, sent: false, reason: 'no issues in last 24h' } }
    }

    const admins = getPlatformAdminEmails()
    if (!admins.length) {
      return { data: { ok: true, sent: false, reason: 'PLATFORM_ADMIN_EMAILS not configured' } }
    }
    if (!isPlatformEmailConfigured()) {
      return { data: { ok: true, sent: false, reason: 'platform SMTP not configured' } }
    }

    const baseUrl = process.env.NEXTAUTH_URL || process.env.APP_BASE_URL || ''
    const adminJobsUrl = baseUrl ? `${baseUrl}/admin/jobs` : '/admin/jobs'

    const lines: string[] = []
    if (failedRuns.length) {
      lines.push(`<h3>Failed cron batches (${failedRuns.length})</h3><ul>`)
      for (const r of failedRuns) {
        lines.push(
          `<li><strong>${escapeHtml(r.name)}</strong> — ${escapeHtml(r.lastError || 'unknown error')} (${new Date(r.startedAt).toISOString()})</li>`,
        )
      }
      lines.push('</ul>')
    }
    if (partialRuns.length) {
      lines.push(`<h3>Partial failures (${partialRuns.length})</h3><ul>`)
      for (const r of partialRuns) {
        lines.push(
          `<li><strong>${escapeHtml(r.name)}</strong> — ${r.failed} failed / ${r.processed} processed (${new Date(r.startedAt).toISOString()})</li>`,
        )
      }
      lines.push('</ul>')
    }
    if (failedEmails.length) {
      lines.push(`<h3>Failed email jobs (${failedEmails.length})</h3><ul>`)
      for (const j of failedEmails) {
        lines.push(
          `<li><strong>${escapeHtml(j.kind)}</strong> org ${escapeHtml(String(j.organizationId))} — ${escapeHtml(j.lastError || 'unknown')}</li>`,
        )
      }
      lines.push('</ul>')
    }

    const html = `
      <p>Kasa ops digest: ${issueCount} issue(s) in the last 24 hours.</p>
      ${lines.join('\n')}
      <p><a href="${escapeHtml(adminJobsUrl)}">View job health dashboard</a></p>
    `

    let sent = 0
    for (const to of admins) {
      const result = await sendPlatformEmail({
        to,
        subject: `[Kasa ops] ${issueCount} job issue(s) in last 24h`,
        html,
        text: `Kasa ops digest: ${issueCount} issue(s). Open ${adminJobsUrl}`,
      })
      if (result.sent) sent += 1
    }

    return { data: { ok: true, sent: sent > 0, issueCount, emailed: sent } }
  },
})

export const GET = POST
