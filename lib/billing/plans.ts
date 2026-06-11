export type PlanTier = 'starter' | 'community' | 'institution'

export const PLAN_TIERS: readonly PlanTier[] = ['starter', 'community', 'institution'] as const

export const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing'])

export const FAMILY_CAP_BY_TIER: Record<PlanTier, number | null> = {
  starter: 75,
  community: 300,
  institution: null,
}

export interface PlanDefinition {
  tier: PlanTier
  name: string
  monthlyPriceLabel: string
  familyCap: number | null
  description: string
  highlights: string[]
}

export const PLAN_DEFINITIONS: PlanDefinition[] = [
  {
    tier: 'starter',
    name: 'Starter',
    monthlyPriceLabel: '$49/mo',
    familyCap: 75,
    description: 'For small kehillos getting started with digital membership.',
    highlights: ['Up to 75 families', 'Member payments & statements', 'Email support'],
  },
  {
    tier: 'community',
    name: 'Community',
    monthlyPriceLabel: '$149/mo',
    familyCap: 300,
    description: 'For growing communities that need more capacity.',
    highlights: ['Up to 300 families', 'Recurring billing automation', 'Priority support'],
  },
  {
    tier: 'institution',
    name: 'Institution',
    monthlyPriceLabel: 'Custom',
    familyCap: null,
    description: 'For large institutions with unlimited scale.',
    highlights: ['Unlimited families', 'Dedicated onboarding', 'Custom contracts'],
  },
]

const PRICE_ENV_BY_TIER: Record<PlanTier, string> = {
  starter: 'STRIPE_PRICE_STARTER',
  community: 'STRIPE_PRICE_COMMUNITY',
  institution: 'STRIPE_PRICE_INSTITUTION',
}

export function getStripePriceIdForTier(tier: PlanTier): string | null {
  const envKey = PRICE_ENV_BY_TIER[tier]
  const value = process.env[envKey]?.trim()
  return value || null
}

export function tierFromStripePriceId(priceId: string | null | undefined): PlanTier | null {
  if (!priceId) return null
  for (const tier of PLAN_TIERS) {
    if (getStripePriceIdForTier(tier) === priceId) return tier
  }
  return null
}

export function familyCapForTier(tier: PlanTier | null | undefined): number | null {
  if (!tier) return null
  return FAMILY_CAP_BY_TIER[tier]
}
