/**
 * POST /api/admin/organizations/seed-demo — create or return the sales demo sandbox org.
 */

import { handler } from '@/lib/api/handler'
import { checkRateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { seedDemoSandboxOrg } from '@/lib/demo-org-seed'

export const dynamic = 'force-dynamic'

export const POST = handler({
  auth: 'admin',
  platformAdminTwoFactor: true,
  platformAdminRecentTotp: true,
  name: 'POST /api/admin/organizations/seed-demo',
  fn: async ({ session, request }) => {
    const rateVerdict = await checkRateLimit(request, 'admin-seed-demo-org', {
      limit: 10,
      windowMs: 60 * 60_000,
    })
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const result = await seedDemoSandboxOrg(session!.user.id)

    if (result.created) {
      await audit({
        organizationId: result.organizationId,
        userId: session!.user.id,
        action: 'platform.demo.seed',
        resourceType: 'Organization',
        resourceId: result.organizationId,
        metadata: {
          slug: result.slug,
          familyCount: result.familyCount,
          paymentCount: result.paymentCount,
        },
        request,
      })
    }

    return {
      data: {
        ...result,
        supportUrl: `/admin/organizations`,
        message: result.created
          ? 'Demo sandbox org created with sample families and payments.'
          : 'Demo sandbox org already exists.',
      },
    }
  },
})
