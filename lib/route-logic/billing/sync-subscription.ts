import { z } from 'zod'
import { handler } from '@/lib/api/handler'
import {
  syncBillingFromCheckoutSession,
  syncOrgSubscriptionFromStripe,
} from '@/lib/billing/subscription-sync'
import { getBillingStripe } from '@/lib/billing/stripe-client'
import { checkRateLimit } from '@/lib/rate-limit'

const syncBody = z.object({
  sessionId: z.string().trim().min(1).optional(),
})

export const POST = handler({
  auth: 'org',
  minRole: 'owner',
  body: syncBody,
  name: 'POST /api/billing/sync',
  fn: async ({ ctx, body, request }) => {
    const stripe = getBillingStripe()
    if (!stripe) {
      return { status: 503, data: { error: 'Stripe is not configured on this server.' } }
    }

    const rateVerdict = await checkRateLimit(
      request,
      'billing-sync',
      { limit: 20, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const synced = body.sessionId
      ? await syncBillingFromCheckoutSession(ctx!.organizationId, body.sessionId, stripe)
      : await syncOrgSubscriptionFromStripe(ctx!.organizationId, stripe)

    if (!synced) {
      return {
        status: 404,
        data: {
          error:
            'No active subscription found yet. Wait a moment and refresh, or confirm your Stripe webhook is configured.',
        },
      }
    }

    return { data: { ok: true } }
  },
})
