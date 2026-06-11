import { NextRequest, NextResponse } from 'next/server'
import { Types } from 'mongoose'
import { requireOrg, type OrgContext, type Role } from '@/lib/auth-helpers'
import { isCronRequest } from '@/lib/auth-cron-verify'

export { isCronRequest } from '@/lib/auth-cron-verify'

/**
 * Variant of `requireOrg` that also accepts a trusted cron call.
 *
 * - If the request carries a valid cron secret AND an `organizationId`
 *   query param, we synthesize a minimal OrgContext for that org (no
 *   user, role implicitly 'owner' for authorization purposes).
 * - Otherwise we fall back to the normal `requireOrg` session check.
 *
 * This lets the same endpoint serve both a logged-in admin clicking
 * a button AND a scheduled cron POST.
 */
export async function requireOrgOrCron(
  request: NextRequest,
  options: { minRole?: Role } = {}
): Promise<OrgContext | NextResponse> {
  if (isCronRequest(request)) {
    const url = new URL(request.url)
    const orgId = url.searchParams.get('organizationId')
    if (!orgId || !Types.ObjectId.isValid(orgId)) {
      return NextResponse.json(
        { error: 'Cron call requires ?organizationId=<id>' },
        { status: 400 }
      )
    }
    return {
      session: {
        user: { id: 'cron', email: 'cron@system', name: 'cron', memberships: [] },
      },
      userId: 'cron',
      organizationId: orgId,
      role: 'owner',
    }
  }

  return requireOrg(request, options)
}
