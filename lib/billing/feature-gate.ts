import { Types } from 'mongoose'
import { Organization, Family } from '@/lib/models'
import { ACTIVE_SUBSCRIPTION_STATUSES, familyCapForTier, type PlanTier } from '@/lib/billing/plans'
import { isStripeConnectEnabled } from '@/lib/stripe/client'

export interface OrgBillingSnapshot {
  planTier?: PlanTier | null
  subscriptionStatus?: string | null
  trialEndsAt?: Date | null
  currentPeriodEnd?: Date | null
  stripeCustomerId?: string | null
  subscriptionId?: string | null
  stripeConnectAccountId?: string | null
  stripeConnectChargesEnabled?: boolean | null
  stripeConnectOnboardingStatus?: string | null
}

export type FeatureGateResult = { ok: true } | { ok: false; error: string; status: number }

const BILLING_FIELDS =
  'planTier subscriptionStatus trialEndsAt currentPeriodEnd stripeCustomerId subscriptionId stripeConnectAccountId stripeConnectChargesEnabled stripeConnectOnboardingStatus'

/**
 * True when platform billing should be enforced. Requires both the Stripe
 * API key and at least one platform price ID — member-card Stripe can be
 * configured without turning on org subscription gates (and keeps the
 * existing integration-test fixtures working).
 */
export function isBillingEnforced(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim() && process.env.STRIPE_PRICE_STARTER?.trim())
}

export function hasActiveSubscription(billing: OrgBillingSnapshot): boolean {
  const status = billing.subscriptionStatus?.trim()
  return Boolean(status && ACTIVE_SUBSCRIPTION_STATUSES.has(status))
}

export function assertCanChargeMembers(billing: OrgBillingSnapshot): FeatureGateResult {
  if (!isBillingEnforced()) return { ok: true }
  if (!hasActiveSubscription(billing)) {
    return {
      ok: false,
      status: 402,
      error:
        'An active Kasa platform subscription is required before charging member cards. Subscribe from Settings → Billing or visit /pricing.',
    }
  }
  if (isStripeConnectEnabled() && !billing.stripeConnectChargesEnabled) {
    return {
      ok: false,
      status: 402,
      error:
        'Complete Stripe Connect onboarding before charging member cards. Go to Settings → Billing to connect your payout account.',
    }
  }
  return { ok: true }
}

export function assertCanAddFamily(
  billing: OrgBillingSnapshot,
  currentFamilyCount: number,
): FeatureGateResult {
  if (!isBillingEnforced()) return { ok: true }
  if (!hasActiveSubscription(billing)) {
    return {
      ok: false,
      status: 402,
      error:
        'An active Kasa platform subscription is required to add families. Subscribe from Settings → Billing or visit /pricing.',
    }
  }
  const cap = familyCapForTier(billing.planTier)
  if (cap !== null && currentFamilyCount >= cap) {
    return {
      ok: false,
      status: 403,
      error: `Your ${billing.planTier ?? 'current'} plan supports up to ${cap} families. Upgrade your subscription to add more.`,
    }
  }
  return { ok: true }
}

export async function loadOrgBillingSnapshot(
  organizationId: string,
): Promise<OrgBillingSnapshot | null> {
  if (!Types.ObjectId.isValid(organizationId)) return null
  return Organization.findById(organizationId).select(BILLING_FIELDS).lean<OrgBillingSnapshot>()
}

export async function countOrgFamilies(organizationId: string): Promise<number> {
  return Family.countDocuments({ organizationId })
}

export async function enforceMemberChargeGate(organizationId: string): Promise<FeatureGateResult> {
  const billing = await loadOrgBillingSnapshot(organizationId)
  if (!billing) {
    return { ok: false, status: 404, error: 'Organization not found' }
  }
  return assertCanChargeMembers(billing)
}

export async function enforceFamilyCapGate(organizationId: string): Promise<FeatureGateResult> {
  const billing = await loadOrgBillingSnapshot(organizationId)
  if (!billing) {
    return { ok: false, status: 404, error: 'Organization not found' }
  }
  const count = await countOrgFamilies(organizationId)
  return assertCanAddFamily(billing, count)
}
