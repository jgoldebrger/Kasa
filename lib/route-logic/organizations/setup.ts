/**
 * POST /api/organizations/setup
 *
 * Marks the first-run setup wizard complete for the active org.
 * Owner-only — members invited into an already-configured org skip this.
 */

import { handler } from '@/lib/api/handler'
import { Organization } from '@/lib/models'
import { audit } from '@/lib/audit'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export const POST = handler({
  auth: 'org',
  minRole: 'owner',
  name: 'POST /api/organizations/setup',
  fn: async ({ ctx, session, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'org-setup-complete',
      { limit: 10, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const org = await Organization.findByIdAndUpdate(
      ctx!.organizationId,
      { $set: { setupCompletedAt: new Date() } },
      { new: true },
    )
      .select('setupCompletedAt')
      .lean<{ setupCompletedAt?: Date | null }>()

    if (!org) return { status: 404, data: { error: 'Organization not found' } }

    await audit({
      organizationId: ctx!.organizationId,
      userId: session!.user.id,
      action: 'org.setup.complete',
      resourceType: 'Organization',
      resourceId: ctx!.organizationId,
      request,
    })

    return {
      data: {
        ok: true,
        setupCompletedAt: org.setupCompletedAt?.toISOString() ?? null,
      },
    }
  },
})
