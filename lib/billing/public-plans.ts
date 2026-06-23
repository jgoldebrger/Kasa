import type Stripe from 'stripe'
import {
  PLAN_DEFINITIONS,
  getStripePriceIdForTier,
  type PlanDefinition,
  type PlanTier,
} from '@/lib/billing/plans'
import { getBillingStripe } from '@/lib/billing/stripe-client'
import { formatMoney } from '@/lib/currency'
import { getSubscriptionTrialDays } from '@/lib/billing/trial'

export interface PublicPlan {
  tier: PlanTier
  name: string
  description: string
  highlights: string[]
  familyCap: number | null
  /** Human-readable price, e.g. "$49/mo" or "Custom". */
  priceLabel: string
  interval: Stripe.Price.Recurring.Interval | null
  available: boolean
  /** Days of free trial on first subscribe, when STRIPE_SUBSCRIPTION_TRIAL_DAYS is set. */
  trialDays: number
}

function intervalSuffix(interval: Stripe.Price.Recurring.Interval | null | undefined): string {
  switch (interval) {
    case 'month':
      return '/mo'
    case 'year':
      return '/yr'
    case 'week':
      return '/wk'
    case 'day':
      return '/day'
    default:
      return ''
  }
}

function formatStripePrice(price: Stripe.Price): string {
  const currency = (price.currency || 'usd').toUpperCase()
  const amount =
    price.unit_amount != null
      ? price.unit_amount / 100
      : price.unit_amount_decimal != null
        ? Number(price.unit_amount_decimal) / 100
        : null
  if (amount == null || Number.isNaN(amount)) {
    return '—'
  }
  const formatted = formatMoney(amount, { currency, trimZeros: true })
  return `${formatted}${intervalSuffix(price.recurring?.interval)}`
}

function productName(price: Stripe.Price, fallback: string): string {
  const product = price.product
  if (product && typeof product === 'object' && 'name' in product && product.name) {
    return product.name
  }
  return fallback
}

async function resolvePurchasablePlan(def: PlanDefinition): Promise<PublicPlan> {
  const trialDays = getSubscriptionTrialDays()
  const base = {
    tier: def.tier,
    description: def.description,
    highlights: def.highlights,
    familyCap: def.familyCap,
    trialDays,
  }

  const priceId = getStripePriceIdForTier(def.tier)
  const stripe = getBillingStripe()

  if (!priceId || !stripe) {
    return {
      ...base,
      name: def.name,
      priceLabel: def.monthlyPriceLabel,
      interval: null,
      available: false,
    }
  }

  try {
    const price = await stripe.prices.retrieve(priceId, { expand: ['product'] })
    if (!price.active) {
      return {
        ...base,
        name: def.name,
        priceLabel: def.monthlyPriceLabel,
        interval: price.recurring?.interval ?? null,
        available: false,
      }
    }
    return {
      ...base,
      name: productName(price, def.name),
      priceLabel: formatStripePrice(price),
      interval: price.recurring?.interval ?? null,
      available: true,
    }
  } catch (err: unknown) {
    console.warn('[billing/public-plans] Stripe price lookup failed:', {
      tier: def.tier,
      message: err instanceof Error ? err.message : String(err),
    })
    return {
      ...base,
      name: def.name,
      priceLabel: def.monthlyPriceLabel,
      interval: null,
      available: false,
    }
  }
}

function institutionPlan(def: PlanDefinition): PublicPlan {
  return {
    tier: def.tier,
    name: def.name,
    description: def.description,
    highlights: def.highlights,
    familyCap: def.familyCap,
    priceLabel: def.monthlyPriceLabel,
    interval: null,
    available: true,
    trialDays: 0,
  }
}

/** Public pricing cards — merges static copy with live Stripe price data when configured. */
export async function loadPublicPlans(): Promise<PublicPlan[]> {
  return Promise.all(
    PLAN_DEFINITIONS.map((def) =>
      def.tier === 'institution' ? institutionPlan(def) : resolvePurchasablePlan(def),
    ),
  )
}
