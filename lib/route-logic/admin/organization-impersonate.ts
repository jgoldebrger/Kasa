/**
 * POST /api/admin/organizations/:id/impersonate
 */

import { NextResponse } from 'next/server'
import { ACTIVE_ORG_COOKIE } from '@/lib/auth-helpers'
import { Organization, User } from '@/lib/models'
import { audit } from '@/lib/audit'
import { checkRateLimit } from '@/lib/rate-limit'
import { handler } from '@/lib/api/handler'
import { setImpersonationCookies } from '@/lib/platform-impersonation'
import { assertPlatformAdminTwoFactor } from '@/lib/platform-admin'
import { assertRecentPlatformAdminTotp } from '@/lib/platform-admin-totp'
import { notifyOrgOwnerOfSupportAccess } from '@/lib/platform-email'
import { notifyPlatformSupportWebhook } from '@/lib/platform-support-webhook'
import { isSupportModeRedirect, type SupportModeRedirect } from '@/lib/support-mode-redirect'
import { validateSupportModeScope, type SupportModeScope } from '@/lib/support-mode-scope'

export const dynamic = 'force-dynamic'

export type ImpersonateBodyResult =
  | {
      ok: true
      reason: string
      readOnly: boolean
      scope: SupportModeScope
      redirectTo: SupportModeRedirect
    }
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
  const scopeResult = validateSupportModeScope(record.scope)
  if (!scopeResult.ok) {
    return { ok: false, error: scopeResult.error }
  }
  let redirectTo: SupportModeRedirect = '/'
  if (record.redirectTo !== undefined && record.redirectTo !== null && record.redirectTo !== '') {
    if (!isSupportModeRedirect(record.redirectTo)) {
      return { ok: false, error: 'Invalid redirectTo' }
    }
    redirectTo = record.redirectTo
  }
  return { ok: true, reason, readOnly, scope: scopeResult.scope, redirectTo }
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
    const { reason, readOnly, scope, redirectTo } = validated

    if (!readOnly) {
      const tfaBlock = await assertPlatformAdminTwoFactor(session!.user.id)
      if (tfaBlock) return tfaBlock
      const totpBlock = assertRecentPlatformAdminTotp(request, session!.user.id)
      if (totpBlock) return totpBlock
    }

    const orgId = String(params.id)
    const org = await Organization.findById(orgId)
      .select('name slug ownerId notifyOwnerOnSupportAccess')
      .lean<{
        name?: string
        slug?: string
        ownerId?: { toString(): string }
        notifyOwnerOnSupportAccess?: boolean
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
      scope,
      redirectTo,
    })

    const ok = setImpersonationCookies(
      res,
      session!.user.id,
      orgId,
      ACTIVE_ORG_COOKIE,
      readOnly,
      scope,
    )
    if (!ok) {
      return { status: 500, data: { error: 'Could not start support session' } }
    }

    const at = new Date()
    const adminEmail = session!.user.email
    const adminName = session!.user.name || adminEmail

    await audit({
      organizationId: orgId,
      userId: session!.user.id,
      action: 'platform.impersonate.start',
      resourceType: 'Organization',
      resourceId: orgId,
      metadata: { orgName: org.name, orgSlug: org.slug, reason, readOnly, scope, redirectTo },
      request,
    })

    try {
      if (org.ownerId && org.notifyOwnerOnSupportAccess !== false) {
        const owner = await User.findById(org.ownerId).select('email').lean<{ email?: string }>()
        if (owner?.email) {
          await notifyOrgOwnerOfSupportAccess({
            ownerEmail: owner.email,
            orgName: org.name || 'Organization',
            adminName,
            adminEmail,
            reason,
            readOnly,
            scope,
            at,
          })
        }
      }
    } catch (err: unknown) {
      console.error(
        '[support-mode] owner notification error:',
        err instanceof Error ? err.message : err,
      )
    }

    notifyPlatformSupportWebhook({
      event: 'impersonate.start',
      orgId,
      orgName: org.name || 'Organization',
      adminEmail,
      reason,
      readOnly,
      scope,
      at: at.toISOString(),
    })

    return res
  },
})
