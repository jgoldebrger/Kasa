import { NextRequest, NextResponse } from 'next/server'
import { Types } from 'mongoose'
import { requireOrg, type OrgContext, type Role } from '@/lib/auth-helpers'
import { isCronRequest } from '@/lib/auth-cron-verify'

export { isCronRequest } from '@/lib/auth-cron-verify'

/**
 * Variant of `requireOrg` that also accepts a trusted cron call.
 *
 * - Cron callers get a synthetic OrgContext (`isCron: true`, `role: 'member'`)
 *   scoped to `?organizationId=<id>`. This is NOT owner/admin — only routes
 *   with `auth: 'org-or-cron'` or `auth: 'cron'` may accept cron auth.
 * - Session callers use normal `requireOrg` (including minRole + DB checks).
 */
export async function requireOrgOrCron(
  request: NextRequest,
  options: { minRole?: Role } = {},
): Promise<OrgContext | NextResponse> {
  if (isCronRequest(request)) {
    const url = new URL(request.url)
    const orgId = url.searchParams.get('organizationId')
    if (!orgId || !Types.ObjectId.isValid(orgId)) {
      return NextResponse.json(
        { error: 'Cron call requires ?organizationId=<id>' },
        { status: 400 },
      )
    }
    return {
      session: {
        user: { id: 'cron', email: 'cron@system', name: 'cron', memberships: [] },
      },
      userId: 'cron',
      organizationId: orgId,
      role: 'member',
      isCron: true,
    }
  }

  return requireOrg(request, options)
}
