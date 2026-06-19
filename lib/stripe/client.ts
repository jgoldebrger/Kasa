import Stripe from 'stripe'
import https from 'https'

const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.NODE_ENV === 'production',
})

const STRIPE_CLIENT_OPTIONS = {
  httpAgent: httpsAgent,
  maxNetworkRetries: 2,
  timeout: 30000,
  apiVersion: '2025-10-29.clover' as const,
}

let platformStripeSingleton: Stripe | null = null

export type StripeConnectOnboardingStatus = 'not_started' | 'pending' | 'complete' | 'restricted'

export interface OrgStripeConnectFields {
  stripeConnectAccountId?: string | null
  stripeConnectOnboardingStatus?: StripeConnectOnboardingStatus | null
  stripeConnectChargesEnabled?: boolean
  stripeConnectPayoutsEnabled?: boolean
  stripeConnectDetailsSubmitted?: boolean
}

export function isStripeConnectEnabled(): boolean {
  const raw = process.env.STRIPE_CONNECT_ENABLED?.trim().toLowerCase()
  return raw === 'true' || raw === '1' || raw === 'yes'
}

export function getPlatformStripe(): Stripe | null {
  const apiKey = process.env.STRIPE_SECRET_KEY?.trim()
  if (!apiKey) return null
  if (!platformStripeSingleton) {
    try {
      platformStripeSingleton = new Stripe(apiKey, STRIPE_CLIENT_OPTIONS)
    } catch (error) {
      console.error('Failed to initialize Stripe:', error)
      return null
    }
  }
  return platformStripeSingleton
}

export interface OrgStripeConnectResult {
  stripe: Stripe
  stripeAccountId: string
}

/**
 * Returns platform Stripe + connected account id when Connect is enabled and
 * the org has a charge-ready Express account. Otherwise null (legacy platform
 * account behavior).
 */
export function getOrgStripeConnect(
  org: OrgStripeConnectFields | null | undefined,
): OrgStripeConnectResult | null {
  if (!org) return null
  if (!isStripeConnectEnabled()) return null
  const accountId = org.stripeConnectAccountId?.trim()
  if (!accountId) return null
  const status = org.stripeConnectOnboardingStatus ?? 'not_started'
  if (status !== 'complete') return null
  if (!org.stripeConnectChargesEnabled) return null

  const stripe = getPlatformStripe()
  if (!stripe) return null

  return { stripe, stripeAccountId: accountId }
}

/** Stripe request options for direct charges on a connected account. */
export function connectRequestOptions(
  connect: OrgStripeConnectResult | null,
  extra?: Stripe.RequestOptions,
): Stripe.RequestOptions {
  const base: Stripe.RequestOptions = connect ? { stripeAccount: connect.stripeAccountId } : {}
  return extra ? { ...base, ...extra } : base
}

/** @deprecated Use connectRequestOptions */
export function stripeConnectRequestOptions(
  org: OrgStripeConnectFields | null | undefined,
): Stripe.RequestOptions {
  return connectRequestOptions(getOrgStripeConnect(org))
}

export function isLegacyPlatformPaymentMethod(savedPaymentMethod: {
  legacyPlatformAccount?: boolean | null
}): boolean {
  if (!isStripeConnectEnabled()) return false
  return savedPaymentMethod.legacyPlatformAccount !== false
}

export function deriveConnectOnboardingStatus(
  account: Pick<
    Stripe.Account,
    'charges_enabled' | 'payouts_enabled' | 'details_submitted' | 'requirements'
  >,
): StripeConnectOnboardingStatus {
  if (account.requirements?.disabled_reason) return 'restricted'
  if (account.charges_enabled && account.details_submitted) return 'complete'
  return 'pending'
}

export function syncOrgConnectFieldsFromAccount(
  org: {
    stripeConnectChargesEnabled?: boolean
    stripeConnectPayoutsEnabled?: boolean
    stripeConnectDetailsSubmitted?: boolean
    stripeConnectOnboardingStatus?: StripeConnectOnboardingStatus | null
  },
  account: Pick<
    Stripe.Account,
    'charges_enabled' | 'payouts_enabled' | 'details_submitted' | 'requirements'
  >,
): void {
  org.stripeConnectChargesEnabled = account.charges_enabled ?? false
  org.stripeConnectPayoutsEnabled = account.payouts_enabled ?? false
  org.stripeConnectDetailsSubmitted = account.details_submitted ?? false
  org.stripeConnectOnboardingStatus = deriveConnectOnboardingStatus(account)
}

export const ORG_CONNECT_SELECT =
  'stripeConnectAccountId stripeConnectOnboardingStatus stripeConnectChargesEnabled stripeConnectPayoutsEnabled stripeConnectDetailsSubmitted'

/** Typed lean result for org Connect field queries. */
export type OrgConnectDoc = OrgStripeConnectFields & { timezone?: string }

export const ORG_CONNECT_WITH_TIMEZONE_SELECT = `timezone ${ORG_CONNECT_SELECT}`

export function getAppBaseUrl(): string {
  return (
    process.env.APP_BASE_URL?.trim() || process.env.NEXTAUTH_URL?.trim() || 'http://localhost:3000'
  )
}
