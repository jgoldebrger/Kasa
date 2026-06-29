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

export type ImpersonateBodyResult =
  | { ok: true; reason: string; readOnly: boolean }
  | { ok: false; error: string }

/** Validates POST body for organization impersonation (exported for unit tests). */
export function validateImpersonateBody(body: unknown): ImpersonateBodyResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Request body required' }
  }
  const record = body as Record<string, unknown>
  const reasonRaw = record.reason
  if (typeof reasonRaw !== 'string') {
    return { ok: false, error: 'Reason is required' }
  }
  const reason = reasonRaw.trim()
  if (reason.length < 3) {
    return { ok: false, error: 'Reason must be at least 3 characters' }
  }
  if (reason.length > 500) {
    return { ok: false, error: 'Reason must be at most 500 characters' }
  }
  const readOnly = record.readOnly === true
  return { ok: true, reason, readOnly }
}

export const POST = handler({
  auth: 'admin',
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

    const body = await request.json().catch(() => null)
    const validated = validateImpersonateBody(body)
    if (!validated.ok) {
      return { status: 400, data: { error: validated.error } }
    }
    const { reason, readOnly } = validated

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
      organizationSlug: org.slug ?? null,
      readOnly,
      redirectTo: '/',
    })

    const ok = setImpersonationCookies(res, session!.user.id, orgId, ACTIVE_ORG_COOKIE, readOnly)
    if (!ok) {
      return { status: 500, data: { error: 'Could not start support session' } }
    }

    await audit({
      organizationId: orgId,
      userId: session!.user.id,
      action: 'platform.impersonate.start',
      resourceType: 'Organization',
      resourceId: orgId,
      metadata: { orgName: org.name, orgSlug: org.slug, reason, readOnly },
      request,
    })

    return res
  },
})
