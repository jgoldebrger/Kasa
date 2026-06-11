import { handler } from '@/lib/api/handler'
import { Organization } from '@/lib/models'
import { getAppBaseUrl, getBillingStripe } from '@/lib/billing/stripe-client'
import { checkRateLimit } from '@/lib/rate-limit'

export const POST = handler({
  auth: 'org',
  minRole: 'owner',
  name: 'POST /api/billing/portal',
  fn: async ({ ctx, request }) => {
    const stripe = getBillingStripe()
    if (!stripe) {
      return {
        status: 503,
        data: { error: 'Stripe is not configured on this server.' },
      }
    }

    const rateVerdict = await checkRateLimit(
      request,
      'billing-portal',
      { limit: 10, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const org = await Organization.findById(ctx!.organizationId)
      .select('stripeCustomerId')
      .lean<{ stripeCustomerId?: string | null }>()
    if (!org?.stripeCustomerId) {
      return {
        status: 400,
        data: {
          error:
            'No Stripe customer on file yet. Start a subscription from the pricing page or Settings → Billing.',
        },
      }
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: `${getAppBaseUrl()}/settings?tab=billing`,
    })

    return { data: { url: portal.url } }
  },
})
