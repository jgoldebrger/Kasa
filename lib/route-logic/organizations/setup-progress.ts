/**
 * GET /api/organizations/setup-progress
 *
 * Lightweight org onboarding checklist state for the dashboard.
 * Counts only — no document hydration.
 */

import { handler } from '@/lib/api/handler'
import { checkRateLimit } from '@/lib/rate-limit'
import { loadSetupProgress } from '@/lib/organizations/setup-progress-data'

export type { SetupProgressStep, SetupProgressStepId } from '@/lib/organizations/setup-progress-data'

export const dynamic = 'force-dynamic'

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/organizations/setup-progress',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'org-setup-progress',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const orgId = ctx!.organizationId
    const payload = await loadSetupProgress(orgId)

    return {
      data: payload,
      headers: { 'Cache-Control': 'private, max-age=15, stale-while-revalidate=60' },
    }
  },
})
