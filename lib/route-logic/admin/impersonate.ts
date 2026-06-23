/**
 * GET /api/admin/impersonate — support session status.
 * DELETE /api/admin/impersonate — exit support mode.
 */

import { NextResponse } from 'next/server'
import { ACTIVE_ORG_COOKIE } from '@/lib/auth-helpers'
import { Organization } from '@/lib/models'
import { audit } from '@/lib/audit'
import { handler } from '@/lib/api/handler'
import { clearImpersonationCookies, readImpersonationOrgId } from '@/lib/platform-impersonation'

export const dynamic = 'force-dynamic'

export const GET = handler({
  auth: 'admin',
  platformAdminTwoFactor: false,
  name: 'GET /api/admin/impersonate',
  fn: async ({ session }) => {
    const orgId = await readImpersonationOrgId(session!.user.id)
    if (!orgId) {
      return { data: { active: false } }
    }

    const org = await Organization.findById(orgId).select('name slug').lean<{
      name?: string
      slug?: string
    }>()

    return {
      data: {
        active: true,
        organizationId: orgId,
        organizationName: org?.name || null,
        organizationSlug: org?.slug || null,
      },
    }
  },
})

export const DELETE = handler({
  auth: 'admin',
  platformAdminTwoFactor: false,
  name: 'DELETE /api/admin/impersonate',
  fn: async ({ session, request }) => {
    const orgId = await readImpersonationOrgId(session!.user.id)

    const res = NextResponse.json({ ok: true })
    clearImpersonationCookies(res, ACTIVE_ORG_COOKIE)

    if (orgId) {
      await audit({
        organizationId: orgId,
        userId: session!.user.id,
        action: 'platform.impersonate.end',
        resourceType: 'Organization',
        resourceId: orgId,
        request,
      })
    }

    return res
  },
})
