import 'server-only'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { ServerOrgContext } from '@/lib/auth-server'
import {
  enforcePlatformAccountAccess,
  isSubscriptionExemptPage,
  platformAccessRedirectPath,
} from '@/lib/billing/account-access'

/**
 * Redirects authenticated users away from the main app when their org has no
 * active platform subscription. Exempt paths (pricing, setup, settings, etc.)
 * are checked via the `x-pathname` header set in middleware.
 */
export async function enforceLayoutSubscriptionGate(
  orgCtx: ServerOrgContext | null,
): Promise<void> {
  if (!orgCtx) return

  const pathname = (await headers()).get('x-pathname') || ''
  if (!pathname || isSubscriptionExemptPage(pathname)) return

  const gate = await enforcePlatformAccountAccess(orgCtx.organizationId)
  if (!gate.ok) {
    redirect(platformAccessRedirectPath(orgCtx.role))
  }
}
