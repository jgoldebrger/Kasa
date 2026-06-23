import { handler } from '@/lib/api/handler'
import { loadPublicPlans } from '@/lib/billing/public-plans'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export const GET = handler({
  auth: 'public',
  name: 'GET /api/billing/plans',
  fn: async ({ request }) => {
    const rateVerdict = await checkRateLimit(request, 'billing-plans-public', {
      limit: 120,
      windowMs: 60_000,
    })
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const plans = await loadPublicPlans()
    return {
      data: { plans },
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
    }
  },
})
