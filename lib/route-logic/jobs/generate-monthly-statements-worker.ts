import { handler } from '@/lib/api/handler'
import { selfUrl } from '@/lib/jobs'
import { generateMonthlyStatements } from '@/lib/scheduler'
import { logError } from '@/lib/log'
import { checkRateLimit } from '@/lib/rate-limit'

const WORKER_JOB_NAME = 'generate-monthly-statements-worker'
const WORKER_PATH = '/api/jobs/generate-monthly-statements/worker'

/**
 * Internal continuation for family-level statement generation. The org
 * cron (`generate-monthly-statements`) kicks off the first family batch
 * per org; this worker self-calls until every family in that org is done.
 *
 * Query params:
 *   organizationId (required)
 *   familyCursor   (optional) — resume after this family _id
 *   year, month    (optional) — explicit statement period
 */
export const POST = handler({
  auth: 'cron',
  cronJobName: WORKER_JOB_NAME,
  name: 'POST /api/jobs/generate-monthly-statements/worker',
  fn: async ({ request }) => {
    const rateVerdict = await checkRateLimit(request, 'cron-generate-monthly-statements-worker', {
      limit: 500,
      windowMs: 60 * 60_000,
    })
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const url = new URL(request.url)
    const organizationId = url.searchParams.get('organizationId')?.trim()
    if (!organizationId) {
      return { status: 400, data: { error: 'organizationId is required' } }
    }

    const familyCursor = url.searchParams.get('familyCursor')
    const yearRaw = url.searchParams.get('year')
    const monthRaw = url.searchParams.get('month')
    let year: number | undefined
    let month: number | undefined
    if (yearRaw != null && yearRaw !== '') {
      year = Number(yearRaw)
      if (!Number.isFinite(year)) {
        return { status: 400, data: { error: 'Invalid year' } }
      }
    }
    if (monthRaw != null && monthRaw !== '') {
      month = Number(monthRaw)
      if (!Number.isFinite(month)) {
        return { status: 400, data: { error: 'Invalid month' } }
      }
    }
    if ((year !== undefined) !== (month !== undefined)) {
      return {
        status: 400,
        data: { error: 'year and month must both be provided when either is set' },
      }
    }

    try {
      const result = await generateMonthlyStatements(organizationId, year, month, {
        familyCursor,
        selfUrl: selfUrl(request, WORKER_PATH),
      })
      return { data: result }
    } catch (err: any) {
      logError(err, { module: 'jobs', job: 'generate-monthly-statements-worker', organizationId })
      throw err
    }
  },
})

export const GET = POST
