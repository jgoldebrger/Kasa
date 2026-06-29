import { NextRequest, NextResponse } from 'next/server'
import type { OrgContext } from '@/lib/auth-helpers'

/** Areas a platform admin may restrict support impersonation to. */
export type SupportModeScope = 'full' | 'communications' | 'billing'

export const SUPPORT_MODE_SCOPES: readonly SupportModeScope[] = [
  'full',
  'communications',
  'billing',
] as const

/** Parse scope from API input; defaults to full for backward compatibility. */
export function parseSupportModeScope(value: unknown): SupportModeScope {
  if (value === 'communications' || value === 'billing') return value
  return 'full'
}

/** Validate scope from impersonation POST body. */
export function validateSupportModeScope(
  value: unknown,
): { ok: true; scope: SupportModeScope } | { ok: false; error: string } {
  if (value === undefined || value === null || value === '') {
    return { ok: true, scope: 'full' }
  }
  if (value === 'full' || value === 'communications' || value === 'billing') {
    return { ok: true, scope: value }
  }
  return { ok: false, error: 'Invalid scope' }
}

const COMMUNICATIONS_API_PREFIXES = [
  '/api/emails',
  '/api/email-templates',
  '/api/email-automation-rules',
  '/api/email-drafts',
  '/api/email-config',
  '/api/scheduled-emails',
  '/api/email/',
] as const

const BILLING_API_PREFIXES = ['/api/billing/'] as const

/** Routes that stay reachable in any scoped support session (org shell, exit, etc.). */
const SCOPE_EXEMPT_API_PREFIXES = [
  '/api/admin/impersonate',
  '/api/organizations/current',
  '/api/organizations',
  '/api/notifications',
  '/api/user/',
  '/api/auth/',
] as const

function matchesApiPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => pathname === p.replace(/\/$/, '') || pathname.startsWith(p))
}

export function isCommunicationsApi(pathname: string): boolean {
  return matchesApiPrefix(pathname, COMMUNICATIONS_API_PREFIXES)
}

export function isBillingApi(pathname: string): boolean {
  return matchesApiPrefix(pathname, BILLING_API_PREFIXES)
}

function isScopeExemptApi(pathname: string): boolean {
  return matchesApiPrefix(pathname, SCOPE_EXEMPT_API_PREFIXES)
}

/**
 * Block cross-area org API access during scoped support impersonation.
 * Returns a 403 response, or null when the request may proceed.
 */
export function blockScopedSupportAccess(
  request: NextRequest,
  ctx: OrgContext | undefined,
): NextResponse | null {
  if (!ctx?.isPlatformImpersonation) return null

  const scope = ctx.supportModeScope ?? 'full'
  if (scope === 'full') return null

  const pathname = new URL(request.url).pathname
  if (isScopeExemptApi(pathname)) return null

  if (scope === 'communications' && isBillingApi(pathname)) {
    return NextResponse.json(
      {
        error:
          'Support mode is limited to communications. Exit support mode or use full or billing scope to access billing.',
      },
      { status: 403 },
    )
  }

  if (scope === 'billing' && isCommunicationsApi(pathname)) {
    return NextResponse.json(
      {
        error:
          'Support mode is limited to billing. Exit support mode or use full or communications scope to access communications.',
      },
      { status: 403 },
    )
  }

  return null
}
