/**
 * POST /api/trash/purge-all — hard-delete everything in the recycle bin.
 *
 * Owner only. This is irreversible.
 */

import { handler } from '@/lib/api/handler'
import { purgeAll } from '@/lib/recycle-bin'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export const POST = handler({
  auth: 'org',
  minRole: 'owner',
  name: 'POST /api/trash/purge-all',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'trash-purge-all',
      { limit: 5, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const counts = await purgeAll(ctx!, { request })
    const total = Object.values(counts).reduce((s, n) => s + n, 0)
    return {
      data: {
        message: `Purged ${total} item${total === 1 ? '' : 's'}`,
        counts,
      },
    }
  },
})
