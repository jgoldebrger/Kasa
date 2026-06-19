import { handler } from '@/lib/api/handler'
import { Organization } from '@/lib/models'
import { checkRateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import {
  getAppBaseUrl,
  getPlatformStripe,
  isStripeConnectEnabled,
  syncOrgConnectFieldsFromAccount,
} from '@/lib/stripe/client'

export const dynamic = 'force-dynamic'

export const POST = handler({
  auth: 'org',
  minRole: 'owner',
  name: 'POST /api/stripe/connect/onboard',
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
      'stripe-connect-onboard',
      { limit: 10, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const org = await Organization.findById(ctx!.organizationId)
    if (!org) {
      return { status: 404, data: { error: 'Organization not found' } }
    }

    let accountId = org.stripeConnectAccountId?.trim() || null
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: {
          organizationId: String(ctx!.organizationId),
        },
      })
      accountId = account.id
      org.stripeConnectAccountId = accountId
      syncOrgConnectFieldsFromAccount(org, account)
      if (
        !org.stripeConnectOnboardingStatus ||
        org.stripeConnectOnboardingStatus === 'not_started'
      ) {
        org.stripeConnectOnboardingStatus = 'pending'
      }
      await org.save()
    }

    const baseUrl = getAppBaseUrl()
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${baseUrl}/settings?tab=billing&connect=refresh`,
      return_url: `${baseUrl}/settings?tab=billing&connect=return`,
      type: 'account_onboarding',
    })

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'stripe.connect.onboard',
      resourceType: 'Organization',
      resourceId: ctx!.organizationId,
      metadata: { stripeConnectAccountId: accountId },
      request,
    })

    return { data: { url: link.url, accountId } }
  },
})
