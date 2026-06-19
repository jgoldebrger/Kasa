import { handler } from '@/lib/api/handler'
import { Organization } from '@/lib/models'
import { checkRateLimit } from '@/lib/rate-limit'
import {
  getPlatformStripe,
  isStripeConnectEnabled,
  ORG_CONNECT_SELECT,
  syncOrgConnectFieldsFromAccount,
  type OrgStripeConnectFields,
  type StripeConnectOnboardingStatus,
} from '@/lib/stripe/client'

export const dynamic = 'force-dynamic'

export interface ConnectStatusPayload {
  connectEnabled: boolean
  stripeConnectAccountId: string | null
  stripeConnectOnboardingStatus: StripeConnectOnboardingStatus
  stripeConnectChargesEnabled: boolean
  stripeConnectPayoutsEnabled: boolean
  stripeConnectDetailsSubmitted: boolean
  requirements?: {
    currentlyDue: string[]
    pastDue: string[]
    disabledReason: string | null
  }
}

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/stripe/connect/status',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'stripe-connect-status',
      { limit: 60, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const connectEnabled = isStripeConnectEnabled()
    const org = await Organization.findById(ctx!.organizationId)
      .select(ORG_CONNECT_SELECT)
      .lean<OrgStripeConnectFields>()
    if (!org) {
      return { status: 404, data: { error: 'Organization not found' } }
    }

    const base: ConnectStatusPayload = {
      connectEnabled,
      stripeConnectAccountId: org.stripeConnectAccountId ?? null,
      stripeConnectOnboardingStatus:
        (org.stripeConnectOnboardingStatus as StripeConnectOnboardingStatus | null) ??
        'not_started',
      stripeConnectChargesEnabled: org.stripeConnectChargesEnabled ?? false,
      stripeConnectPayoutsEnabled: org.stripeConnectPayoutsEnabled ?? false,
      stripeConnectDetailsSubmitted: org.stripeConnectDetailsSubmitted ?? false,
    }

    if (!connectEnabled || !org.stripeConnectAccountId) {
      return { data: base }
    }

    const stripe = getPlatformStripe()
    if (!stripe) {
      return { data: base }
    }

    try {
      const account = await stripe.accounts.retrieve(org.stripeConnectAccountId)
      const statusPatch = {
        stripeConnectOnboardingStatus: base.stripeConnectOnboardingStatus,
      }
      syncOrgConnectFieldsFromAccount(statusPatch, account)

      await Organization.findByIdAndUpdate(ctx!.organizationId, {
        $set: {
          stripeConnectChargesEnabled: account.charges_enabled ?? false,
          stripeConnectPayoutsEnabled: account.payouts_enabled ?? false,
          stripeConnectDetailsSubmitted: account.details_submitted ?? false,
          stripeConnectOnboardingStatus: statusPatch.stripeConnectOnboardingStatus,
        },
      })

      return {
        data: {
          ...base,
          stripeConnectChargesEnabled: account.charges_enabled ?? false,
          stripeConnectPayoutsEnabled: account.payouts_enabled ?? false,
          stripeConnectDetailsSubmitted: account.details_submitted ?? false,
          stripeConnectOnboardingStatus: statusPatch.stripeConnectOnboardingStatus,
          requirements: {
            currentlyDue: account.requirements?.currently_due ?? [],
            pastDue: account.requirements?.past_due ?? [],
            disabledReason: account.requirements?.disabled_reason ?? null,
          },
        },
      }
    } catch (err: unknown) {
      console.warn('[stripe/connect/status] accounts.retrieve failed:', (err as Error)?.message)
      return { data: base }
    }
  },
})
