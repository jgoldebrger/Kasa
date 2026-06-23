/**
 * POST /api/admin/organizations/:id/mark-setup-complete
 * Escape hatch for ops when a tenant finished setup outside the wizard.
 */

import { Organization } from '@/lib/models'
import { audit } from '@/lib/audit'
import { checkRateLimit } from '@/lib/rate-limit'
import { handler } from '@/lib/api/handler'

export const dynamic = 'force-dynamic'

export const POST = handler({
  auth: 'admin',
  idParams: ['id'],
  name: 'POST /api/admin/organizations/:id/mark-setup-complete',
  fn: async ({ session, params, request }) => {
    const rateVerdict = await checkRateLimit(request, 'admin-mark-setup-complete', {
      limit: 30,
      windowMs: 60 * 60_000,
    })
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const orgId = String(params.id)
    const org = await Organization.findByIdAndUpdate(
      orgId,
      { $set: { setupCompletedAt: new Date() } },
      { new: true },
    )
      .select('name slug setupCompletedAt')
      .lean<{ name?: string; slug?: string; setupCompletedAt?: Date | null }>()

    if (!org) {
      return { status: 404, data: { error: 'Organization not found' } }
    }

    await audit({
      organizationId: orgId,
      userId: session!.user.id,
      action: 'platform.setup.mark_complete',
      resourceType: 'Organization',
      resourceId: orgId,
      metadata: { orgName: org.name, orgSlug: org.slug },
      request,
    })

    return {
      data: {
        ok: true,
        setupCompletedAt: org.setupCompletedAt,
      },
    }
  },
})
