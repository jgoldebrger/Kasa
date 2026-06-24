import { z } from 'zod'
import Stripe from 'stripe'
import { handler } from '@/lib/api/handler'
import { Organization, User } from '@/lib/models'
import { getStripePriceIdForTier } from '@/lib/billing/plans'
import { getAppBaseUrl, getBillingStripe } from '@/lib/billing/stripe-client'
import { resolveCheckoutTrialDays } from '@/lib/billing/trial'
import { checkRateLimit } from '@/lib/rate-limit'
import { sanitizeStripeErrorMessage } from '@/lib/payments/sanitize'

const checkoutBody = z.object({
  planTier: z.enum(['starter', 'community', 'institution']),
})

function checkoutError(err: unknown): { status: number; error: string } {
  if (err instanceof Stripe.errors.StripeError) {
    console.error('[billing/checkout] Stripe API error:', {
      type: err.type,
      code: err.code,
      message: err.message,
    })
    return { status: 502, error: sanitizeStripeErrorMessage(err.message) }
  }
  if (err instanceof Error && err.message) {
    console.error('[billing/checkout] Error:', err.message)
    return { status: 500, error: sanitizeStripeErrorMessage(err.message) }
  }
  return { status: 500, error: 'Could not start checkout.' }
}

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
        data: {
          error: `The ${body.planTier} plan is not configured yet. Set STRIPE_PRICE_${body.planTier.toUpperCase()} in your server environment (Stripe Dashboard → Products → copy the price ID).`,
        },
      }
    }

    const org = await Organization.findById(ctx!.organizationId)
      .select('name stripeCustomerId ownerId subscriptionId subscriptionStatus setupCompletedAt')
      .lean<{
        name?: string
        stripeCustomerId?: string | null
        ownerId?: { toString(): string }
        subscriptionId?: string | null
        subscriptionStatus?: string | null
        setupCompletedAt?: Date | null
      }>()
    if (!org) {
      return { status: 404, data: { error: 'Organization not found' } }
    }

    const owner = await User.findById(org.ownerId).select('email').lean<{ email?: string }>()
    const customerEmail = org.stripeCustomerId
      ? undefined
      : (owner?.email || ctx!.session!.user.email)?.trim()
    if (!org.stripeCustomerId && !customerEmail) {
      return {
        status: 400,
        data: { error: 'No email on file for checkout. Update your account email and try again.' },
      }
    }

    const baseUrl = getAppBaseUrl()
    const trialDays = resolveCheckoutTrialDays(org)
    const checkoutReturn = org.setupCompletedAt
      ? `/settings?tab=billing&checkout=success&session_id={CHECKOUT_SESSION_ID}`
      : `/setup?checkout=success&session_id={CHECKOUT_SESSION_ID}`

    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: org.stripeCustomerId || undefined,
        customer_email: customerEmail,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${baseUrl}${checkoutReturn}`,
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
          ...(trialDays ? { trial_period_days: trialDays } : {}),
        },
        allow_promotion_codes: true,
      })

      if (!session.url) {
        return { status: 500, data: { error: 'Stripe did not return a checkout URL.' } }
      }

      return { data: { url: session.url, sessionId: session.id } }
    } catch (err: unknown) {
      const { status, error } = checkoutError(err)
      return { status, data: { error } }
    }
  },
})
