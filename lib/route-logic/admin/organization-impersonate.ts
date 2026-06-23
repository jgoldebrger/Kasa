/**
 * POST /api/admin/organizations/:id/impersonate
 */

import { NextResponse } from 'next/server'
import { ACTIVE_ORG_COOKIE } from '@/lib/auth-helpers'
import { Organization } from '@/lib/models'
import { audit } from '@/lib/audit'
import { checkRateLimit } from '@/lib/rate-limit'
import { handler } from '@/lib/api/handler'
import { setImpersonationCookies } from '@/lib/platform-impersonation'

export const dynamic = 'force-dynamic'

export const POST = handler({
  auth: 'admin',
  platformAdminTwoFactor: false,
  idParams: ['id'],
  name: 'POST /api/admin/organizations/:id/impersonate',
  fn: async ({ session, params, request }) => {
    const rateVerdict = await checkRateLimit(request, 'admin-impersonate-start', {
      limit: 30,
      windowMs: 60 * 60_000,
    })
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const orgId = String(params.id)
    const org = await Organization.findById(orgId).select('name slug').lean<{
      name?: string
      slug?: string
    }>()
    if (!org) {
      return { status: 404, data: { error: 'Organization not found' } }
    }

    const res = NextResponse.json({
      ok: true,
      organizationId: orgId,
      organizationName: org.name,
      redirectTo: '/',
    })

    const ok = setImpersonationCookies(res, session!.user.id, orgId, ACTIVE_ORG_COOKIE)
    if (!ok) {
      return { status: 500, data: { error: 'Could not start support session' } }
    }

    await audit({
      organizationId: orgId,
      userId: session!.user.id,
      action: 'platform.impersonate.start',
      resourceType: 'Organization',
      resourceId: orgId,
      metadata: { orgName: org.name, orgSlug: org.slug },
      request,
    })

    return res
  },
})
