/**
 * GET /api/admin/impersonate — support session status.
 * DELETE /api/admin/impersonate — exit support mode.
 */

import { NextResponse } from 'next/server'
import { ACTIVE_ORG_COOKIE } from '@/lib/auth-helpers'
import { Organization } from '@/lib/models'
import { audit } from '@/lib/audit'
import { handler } from '@/lib/api/handler'
import {
  clearImpersonationCookies,
  readImpersonationOrgId,
  readImpersonationReadOnly,
  readImpersonationScope,
  readImpersonationExpiresAt,
  readImpersonationSession,
} from '@/lib/platform-impersonation'
import { getSupportSessionActions } from '@/lib/support-session-summary'
import { notifyPlatformSupportWebhook } from '@/lib/platform-support-webhook'

export const dynamic = 'force-dynamic'

export const GET = handler({
  auth: 'admin',
  name: 'GET /api/admin/impersonate',
  fn: async ({ session }) => {
    const orgId = await readImpersonationOrgId(session!.user.id)
    if (!orgId) {
      return { data: { active: false } }
    }

    const [org, readOnly, scope, expiresAt] = await Promise.all([
      Organization.findById(orgId).select('name slug').lean<{
        name?: string
        slug?: string
      }>(),
      readImpersonationReadOnly(session!.user.id),
      readImpersonationScope(session!.user.id),
      readImpersonationExpiresAt(session!.user.id),
    ])

    return {
      data: {
        active: true,
        organizationId: orgId,
        organizationName: org?.name || null,
        organizationSlug: org?.slug || null,
        readOnly,
        scope,
        expiresAt,
      },
    }
  },
})

export const DELETE = handler({
  auth: 'admin',
  name: 'DELETE /api/admin/impersonate',
  fn: async ({ session, request }) => {
    const impersonation = await readImpersonationSession(session!.user.id)
    const orgId = impersonation?.orgId ?? null
    const readOnly = impersonation?.readOnly ?? false
    const scope = impersonation?.scope ?? 'full'
    const org = orgId
      ? await Organization.findById(orgId).select('name').lean<{ name?: string }>()
      : null

    let actions: { action: string; at: string }[] = []
    if (impersonation) {
      actions = await getSupportSessionActions(
        session!.user.id,
        impersonation.orgId,
        impersonation.startedAt,
      )
    }

    const res = NextResponse.json({ ok: true, actions })
    clearImpersonationCookies(res, ACTIVE_ORG_COOKIE)

    if (orgId) {
      await audit({
        organizationId: orgId,
        userId: session!.user.id,
        action: 'platform.impersonate.end',
        resourceType: 'Organization',
        resourceId: orgId,
        metadata: {
          ...(actions.length > 0 ? { actionCount: actions.length } : {}),
          scope,
        },
        request,
      })

      notifyPlatformSupportWebhook({
        event: 'impersonate.end',
        orgId,
        orgName: org?.name || 'Organization',
        adminEmail: session!.user.email,
        readOnly,
        scope,
        at: new Date().toISOString(),
      })
    }

    return res
  },
})
