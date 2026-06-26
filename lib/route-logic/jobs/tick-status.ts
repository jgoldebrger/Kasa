import { JobRun } from '@/lib/models'
import { checkRateLimit } from '@/lib/rate-limit'
import { handler } from '@/lib/api/handler'

export const dynamic = 'force-dynamic'

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/jobs/tick-status',
  fn: async ({ request }) => {
    const rateVerdict = await checkRateLimit(request, 'jobs-tick-status', {
      limit: 120,
      windowMs: 60_000,
    })
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const lastTick = await JobRun.findOne({ name: 'tick' }).sort({ startedAt: -1 }).lean<{
      _id: unknown
      name?: string
      status?: string
      startedAt?: Date
      completedAt?: Date | null
      processed?: number
      failed?: number
      metadata?: unknown
      lastError?: string | null
    } | null>()

    if (!lastTick) {
      return { data: { lastTick: null } }
    }

    return {
      data: {
        lastTick: {
          id: String(lastTick._id),
          name: lastTick.name,
          status: lastTick.status,
          startedAt: lastTick.startedAt,
          completedAt: lastTick.completedAt ?? null,
          processed: lastTick.processed ?? 0,
          failed: lastTick.failed ?? 0,
          metadata: lastTick.metadata ?? null,
          lastError: lastTick.lastError ?? null,
        },
      },
    }
  },
})
