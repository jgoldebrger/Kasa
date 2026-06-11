/**
 * GET /api/trash — list every soft-deleted item in the active org, grouped
 * by kind, with a days-until-purge countdown.
 *
 * Admin+ only. Used by the recycle bin tab in Settings.
 */

import { handler } from '@/lib/api/handler'
import { listTrash } from '@/lib/recycle-bin'
import { checkRateLimit } from '@/lib/rate-limit'
import { paginationLimit } from '@/lib/schemas'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const trashQuery = z.object({
  limit: paginationLimit,
})

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  query: trashQuery,
  name: 'GET /api/trash',
  fn: async ({ ctx, query, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'trash-list',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const data = await listTrash(ctx!.organizationId, {
      limitPerKind: query.limit ?? undefined,
    })
    return { data }
  },
})
