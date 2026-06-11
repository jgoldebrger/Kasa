import { z } from 'zod'
import { handler } from '@/lib/api/handler'
import { Organization, User } from '@/lib/models'
import { getStripePriceIdForTier } from '@/lib/billing/plans'
import { getAppBaseUrl, getBillingStripe } from '@/lib/billing/stripe-client'
import { checkRateLimit } from '@/lib/rate-limit'

const checkoutBody = z.object({
  planTier: z.enum(['starter', 'community', 'institution']),
})

export const POST = handler({
  auth: 'org',
  minRole: 'owner',
  body: checkoutBody,
  name: 'POST /api/billing/checkout',
  fn: async ({ ctx, body, request }) => {
    const stripe = getBillingStripe()
    if (!stripe) {
      return {
        status: 503,
        data: { error: 'Stripe is not configured on this server.' },
      }
    }

    const rateVerdict = await checkRateLimit(
      request,
      'billing-checkout',
      { limit: 10, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const priceId = getStripePriceIdForTier(body.planTier)
    if (!priceId) {
      return {
        status: 503,
        data: { error: `Stripe price is not configured for the ${body.planTier} plan.` },
      }
    }

    const org = await Organization.findById(ctx!.organizationId)
      .select('name stripeCustomerId ownerId')
      .lean<{ name?: string; stripeCustomerId?: string | null; ownerId?: { toString(): string } }>()
    if (!org) {
      return { status: 404, data: { error: 'Organization not found' } }
    }

    const owner = await User.findById(org.ownerId).select('email').lean<{ email?: string }>()
    const baseUrl = getAppBaseUrl()

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: org.stripeCustomerId || undefined,
      customer_email: org.stripeCustomerId ? undefined : owner?.email || ctx!.session.user.email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/settings?tab=billing&checkout=success`,
      cancel_url: `${baseUrl}/pricing?checkout=cancelled`,
      metadata: {
        organizationId: ctx!.organizationId,
        planTier: body.planTier,
      },
      subscription_data: {
        metadata: {
          organizationId: ctx!.organizationId,
          planTier: body.planTier,
        },
      },
      allow_promotion_codes: true,
    })

    if (!session.url) {
      return { status: 500, data: { error: 'Stripe did not return a checkout URL.' } }
    }

    return { data: { url: session.url, sessionId: session.id } }
  },
})
