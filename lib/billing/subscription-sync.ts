import type Stripe from 'stripe'
import { Organization } from '@/lib/models'
import {
  handleCheckoutSessionCompleted,
  syncSubscriptionToOrganization,
} from '@/lib/billing/subscription-webhook'

async function loadOrgBillingIds(organizationId: string) {
  return Organization.findById(organizationId)
    .select('stripeCustomerId subscriptionId')
    .lean<{ stripeCustomerId?: string | null; subscriptionId?: string | null }>()
}

/** Pull the latest platform subscription for an org from Stripe into Mongo. */
export async function syncOrgSubscriptionFromStripe(
  organizationId: string,
  stripe: Stripe,
): Promise<boolean> {
  const org = await loadOrgBillingIds(organizationId)
  if (!org) return false

  let subscription: Stripe.Subscription | null = null

  if (org.subscriptionId?.trim()) {
    try {
      subscription = await stripe.subscriptions.retrieve(org.subscriptionId)
    } catch {
      subscription = null
    }
  }

  if (!subscription && org.stripeCustomerId?.trim()) {
    const listed = await stripe.subscriptions.list({
      customer: org.stripeCustomerId,
      status: 'all',
      limit: 10,
    })
    subscription =
      listed.data.find((s) => s.status === 'active' || s.status === 'trialing') ??
      listed.data[0] ??
      null
  }

  if (!subscription) return false

  await syncSubscriptionToOrganization(subscription)
  return true
}

/** Sync billing after Stripe Checkout redirect (does not require webhooks). */
export async function syncBillingFromCheckoutSession(
  organizationId: string,
  sessionId: string,
  stripe: Stripe,
): Promise<boolean> {
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['subscription'],
  })

  if (session.metadata?.organizationId?.trim() !== organizationId) {
    return false
  }

  await handleCheckoutSessionCompleted(session, stripe)

  const expanded = session.subscription
  if (expanded && typeof expanded === 'object') {
    await syncSubscriptionToOrganization(expanded)
    return true
  }

  return syncOrgSubscriptionFromStripe(organizationId, stripe)
}
