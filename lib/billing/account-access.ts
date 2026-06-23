import type { Role } from '@/lib/auth-helpers'
import {
  hasActiveSubscription,
  isBillingEnforced,
  loadOrgBillingSnapshot,
  type OrgBillingSnapshot,
  type FeatureGateResult,
} from '@/lib/billing/feature-gate'

/** Page prefixes reachable without an active platform subscription. */
export const SUBSCRIPTION_EXEMPT_PAGE_PREFIXES = [
  '/welcome',
  '/login',
  '/signup',
  '/invite',
  '/reset-password',
  '/request-invite',
  '/pricing',
  '/setup',
  '/settings',
  '/privacy',
  '/terms',
  '/dpa',
  '/subprocessors',
  '/trust',
  '/help',
  '/overview',
  '/status',
  '/offline',
  '/admin',
] as const

/** API prefixes that stay callable while the org has no subscription. */
export const SUBSCRIPTION_EXEMPT_API_PREFIXES = [
  '/api/billing/',
  '/api/organizations/current',
  '/api/organizations/setup',
  '/api/stripe/connect/',
  '/api/notifications',
  '/api/stripe/webhook',
  '/api/auth/',
] as const

export function isSubscriptionExemptPage(pathname: string): boolean {
  return SUBSCRIPTION_EXEMPT_PAGE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )
}

export function isSubscriptionExemptApi(pathname: string): boolean {
  // Org list / switcher — no subscription required.
  if (pathname === '/api/organizations') return true
  return SUBSCRIPTION_EXEMPT_API_PREFIXES.some(
    (p) => pathname === p.replace(/\/$/, '') || pathname.startsWith(p),
  )
}

export function platformAccessRedirectPath(role: Role): string {
  if (role === 'owner') {
    return '/pricing?subscribe=required'
  }
  return '/pricing?subscribe=required&contact=owner'
}

export function assertPlatformAccountAccess(billing: OrgBillingSnapshot): FeatureGateResult {
  if (!isBillingEnforced()) return { ok: true }
  if (hasActiveSubscription(billing)) return { ok: true }
  return {
    ok: false,
    status: 402,
    error:
      'An active Kasa platform subscription is required to use this workspace. Subscribe from Settings → Billing or visit /pricing.',
  }
}

export async function enforcePlatformAccountAccess(
  organizationId: string,
): Promise<FeatureGateResult> {
  const billing = await loadOrgBillingSnapshot(organizationId)
  if (!billing) {
    return { ok: false, status: 404, error: 'Organization not found' }
  }
  return assertPlatformAccountAccess(billing)
}

export interface PlatformAccessSnapshot {
  required: boolean
  active: boolean
}

export function getPlatformAccessSnapshot(billing: OrgBillingSnapshot): PlatformAccessSnapshot {
  const required = isBillingEnforced()
  return {
    required,
    active: !required || hasActiveSubscription(billing),
  }
}
