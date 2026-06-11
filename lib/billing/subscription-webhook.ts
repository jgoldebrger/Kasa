import Stripe from 'stripe'
import { Organization } from '@/lib/models'
import { tierFromStripePriceId, type PlanTier } from '@/lib/billing/plans'

type SubscriptionLike = Pick<
  Stripe.Subscription,
  'id' | 'customer' | 'status' | 'metadata' | 'items' | 'trial_end'
>

function customerId(customer: Stripe.Subscription['customer']): string | null {
  if (!customer) return null
  return typeof customer === 'string' ? customer : customer.id
}

function resolvePlanTier(subscription: SubscriptionLike): PlanTier | null {
  const fromMetadata = subscription.metadata?.planTier
  if (fromMetadata === 'starter' || fromMetadata === 'community' || fromMetadata === 'institution') {
    return fromMetadata
  }
  const priceId = subscription.items?.data?.[0]?.price?.id
  return tierFromStripePriceId(priceId)
}

function subscriptionDates(subscription: SubscriptionLike) {
  const itemPeriodEnd = subscription.items?.data?.[0]?.current_period_end
  return {
    trialEndsAt:
      typeof subscription.trial_end === 'number'
        ? new Date(subscription.trial_end * 1000)
        : null,
    currentPeriodEnd:
      typeof itemPeriodEnd === 'number' ? new Date(itemPeriodEnd * 1000) : null,
  }
}

async function resolveOrganizationId(
  subscription: SubscriptionLike,
): Promise<string | null> {
  const fromMetadata = subscription.metadata?.organizationId?.trim()
  if (fromMetadata) return fromMetadata

  const custId = customerId(subscription.customer)
  if (!custId) return null

  const org = await Organization.findOne({ stripeCustomerId: custId })
    .select('_id')
    .lean<{ _id: { toString(): string } }>()
  return org ? org._id.toString() : null
}

export async function syncSubscriptionToOrganization(
  subscription: SubscriptionLike,
): Promise<void> {
  const organizationId = await resolveOrganizationId(subscription)
  if (!organizationId) return

  const planTier = resolvePlanTier(subscription)
  const dates = subscriptionDates(subscription)

  await Organization.findByIdAndUpdate(organizationId, {
    subscriptionId: subscription.id,
    stripeCustomerId: customerId(subscription.customer),
    planTier,
    subscriptionStatus: subscription.status,
    trialEndsAt: dates.trialEndsAt,
    currentPeriodEnd: dates.currentPeriodEnd,
  })
}

export async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const organizationId = session.metadata?.organizationId?.trim()
  if (!organizationId) return

  const customer = session.customer
  const customerId = typeof customer === 'string' ? customer : customer?.id
  if (!customerId) return

  const update: Record<string, unknown> = { stripeCustomerId: customerId }
  const subscription = session.subscription
  const subscriptionId = typeof subscription === 'string' ? subscription : subscription?.id
  if (subscriptionId) {
    update.subscriptionId = subscriptionId
  }
  const planTier = session.metadata?.planTier
  if (planTier === 'starter' || planTier === 'community' || planTier === 'institution') {
    update.planTier = planTier
  }

  await Organization.findByIdAndUpdate(organizationId, update)
}
