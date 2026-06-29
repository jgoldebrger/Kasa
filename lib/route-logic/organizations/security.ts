/**
 * Per-organization security preferences.
 *
 * GET   /api/organizations/security — return security settings for the active org.
 * PATCH /api/organizations/security — owner updates security settings.
 */

import { z } from 'zod'
import { handler } from '@/lib/api/handler'
import { Organization } from '@/lib/models'
import { audit } from '@/lib/audit'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const patchBody = z.object({
  notifyOwnerOnSupportAccess: z.boolean(),
})

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/organizations/security',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'org-security-get',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const org = await Organization.findById(ctx!.organizationId)
      .select('notifyOwnerOnSupportAccess')
      .lean<{ notifyOwnerOnSupportAccess?: boolean }>()
    if (!org) return { status: 404, data: { error: 'Organization not found' } }

    return {
      data: {
        notifyOwnerOnSupportAccess: org.notifyOwnerOnSupportAccess !== false,
      },
      headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=300' },
    }
  },
})

export const PATCH = handler({
  auth: 'org',
  minRole: 'owner',
  body: patchBody,
  name: 'PATCH /api/organizations/security',
  fn: async ({ ctx, body, session, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'org-security-patch',
      { limit: 30, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const updated = await Organization.findByIdAndUpdate(
      ctx!.organizationId,
      { $set: { notifyOwnerOnSupportAccess: !!body.notifyOwnerOnSupportAccess } },
      { new: true },
    )
      .select('notifyOwnerOnSupportAccess')
      .lean<{ notifyOwnerOnSupportAccess?: boolean }>()
    if (!updated) return { status: 404, data: { error: 'Organization not found' } }

    await audit({
      organizationId: ctx!.organizationId,
      userId: session!.user.id,
      action: 'org.settings.update',
      resourceType: 'Organization',
      resourceId: ctx!.organizationId,
      metadata: { fields: ['notifyOwnerOnSupportAccess'] },
      request,
    })

    return {
      data: {
        notifyOwnerOnSupportAccess: updated.notifyOwnerOnSupportAccess !== false,
      },
    }
  },
})
