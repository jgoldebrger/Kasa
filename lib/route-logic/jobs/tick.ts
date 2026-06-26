/**
 * Unified cron dispatcher for Vercel Hobby (single crons[] slot).
 *
 * GET/POST /api/jobs/tick — secured by CRON_SECRET.
 *
 * Schedule: every 15 minutes via vercel.json.
 *   - Always runs send-scheduled-emails.
 *   - At UTC :00, also triggers daily jobs for that hour (separate
 *     serverless invocations via internal fetch).
 */

import { handler } from '@/lib/api/handler'
import { checkRateLimit } from '@/lib/rate-limit'
import { selfUrl } from '@/lib/jobs'
import { jobsForTick } from './cron-schedule'
import { logError } from '@/lib/log'

const JOB_NAME = 'tick'

export interface CronJobResult {
  path: string
  status: number
  ok: boolean
  skipped?: boolean
}

async function invokeCronJob(request: Request, path: string): Promise<CronJobResult> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return { path, status: 500, ok: false, skipped: true }
  }

  const url = selfUrl(request, path)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      logError(new Error(`Cron tick child job failed: ${path} ${res.status}`), {
        path,
        status: res.status,
        body: text.slice(0, 500),
      })
    }
    return { path, status: res.status, ok: res.ok }
  } catch (err) {
    logError(err, { context: 'cron-tick-invoke', path })
    return { path, status: 500, ok: false }
  }
}

export const POST = handler({
  auth: 'cron',
  cronJobName: JOB_NAME,
  name: 'POST /api/jobs/tick',
  fn: async ({ request }) => {
    const rateVerdict = await checkRateLimit(request, 'cron-tick', {
      limit: 20,
      windowMs: 60 * 60_000,
    })
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const now = new Date()
    const utcHour = now.getUTCHours()
    const utcMinute = now.getUTCMinutes()
    const paths = jobsForTick(utcHour, utcMinute)

    const results: CronJobResult[] = []
    for (const path of paths) {
      results.push(await invokeCronJob(request, path))
    }

    const failed = results.filter((r) => !r.ok)
    return {
      data: {
        ranAt: now.toISOString(),
        utcHour,
        utcMinute,
        jobs: paths,
        results,
        ok: failed.length === 0,
      },
    }
  },
})

export const GET = POST
