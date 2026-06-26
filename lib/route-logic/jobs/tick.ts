/**
 * Unified cron dispatcher (single vercel.json crons[] entry).
 *
 * GET/POST /api/jobs/tick — secured by CRON_SECRET.
 *
 * Hobby (default): vercel.json `0 8 * * *` — runs all jobs once per day.
 * Pro: set CRON_TICK_MODE=frequent and a 15-minute vercel.json schedule.
 */

import { handler } from '@/lib/api/handler'
import { JobRun } from '@/lib/models'
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

    const jobRun = await JobRun.create({
      name: JOB_NAME,
      status: 'running',
      startedAt: now,
      metadata: { utcHour, utcMinute, jobs: paths },
    })

    try {
      const results: CronJobResult[] = []
      for (const path of paths) {
        results.push(await invokeCronJob(request, path))
      }

      const failed = results.filter((r) => !r.ok)
      await JobRun.findByIdAndUpdate(jobRun._id, {
        status: 'completed',
        completedAt: new Date(),
        processed: results.length,
        failed: failed.length,
        metadata: {
          utcHour,
          utcMinute,
          jobs: paths,
          results,
          ok: failed.length === 0,
          ranAt: now.toISOString(),
        },
        lastError:
          failed.length > 0
            ? `Child jobs failed: ${failed.map((r) => r.path).join(', ')}`
            : undefined,
      })

      return {
        data: {
          jobRunId: String(jobRun._id),
          ranAt: now.toISOString(),
          utcHour,
          utcMinute,
          jobs: paths,
          results,
          ok: failed.length === 0,
        },
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      await JobRun.findByIdAndUpdate(jobRun._id, {
        status: 'failed',
        completedAt: new Date(),
        lastError: message,
      })
      throw err
    }
  },
})

export const GET = POST
