import { handler } from '@/lib/api/handler'
import { Organization } from '@/lib/models'
import { checkRateLimit } from '@/lib/rate-limit'
import { getPlatformStripe, isStripeConnectEnabled } from '@/lib/stripe/client'

export const dynamic = 'force-dynamic'

export const POST = handler({
  auth: 'org',
  minRole: 'owner',
  name: 'POST /api/stripe/connect/dashboard',
  fn: async ({ ctx, request }) => {
    if (!isStripeConnectEnabled()) {
      return { status: 403, data: { error: 'Stripe Connect is not enabled on this server.' } }
    }

    const stripe = getPlatformStripe()
    if (!stripe) {
      return { status: 503, data: { error: 'Stripe is not configured on this server.' } }
    }

    const rateVerdict = await checkRateLimit(
      request,
      'stripe-connect-dashboard',
      { limit: 10, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const org = await Organization.findById(ctx!.organizationId)
      .select('stripeConnectAccountId')
      .lean<{ stripeConnectAccountId?: string | null }>()
    if (!org?.stripeConnectAccountId) {
      return {
        status: 400,
        data: { error: 'No Stripe Connect account yet. Start onboarding from Settings → Billing.' },
      }
    }

    const loginLink = await stripe.accounts.createLoginLink(org.stripeConnectAccountId)
    return { data: { url: loginLink.url } }
  },
})
