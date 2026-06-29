/**
 * GET /api/organizations/export — full organization data export (JSON).
 */

import { NextResponse } from 'next/server'
import { checkOrgBulkRateLimit, orgBulkRateLimit429 } from '@/lib/org-bulk-rate-limit'
import { handler } from '@/lib/api/handler'
import { audit } from '@/lib/audit'
import { buildOrgExportBundle } from '@/lib/org-export'
import { Organization } from '@/lib/models'

export const dynamic = 'force-dynamic'

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/organizations/export',
  fn: async ({ ctx, request }) => {
    const org = await Organization.findById(ctx!.organizationId)
      .select('slug name rateLimits')
      .lean<{
        slug?: string
        name?: string
        rateLimits?: { exportPerHour?: number | null }
      }>()
    const rateVerdict = await checkOrgBulkRateLimit(
      request,
      ctx!.organizationId,
      'export',
      org?.rateLimits,
    )
    if (!rateVerdict.allowed) {
      return orgBulkRateLimit429(rateVerdict, 'Too many export requests. Try again later.')
    }

    if (!org) {
      return { status: 404, data: { error: 'Organization not found' } }
    }

    const bundle = await buildOrgExportBundle(ctx!.organizationId)

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'org.export',
      resourceType: 'Organization',
      resourceId: ctx!.organizationId,
      metadata: {
        familyCount: bundle.families.length,
        memberCount: bundle.familyMembers.length,
      },
      request,
    })

    const safeSlug = (org.slug || 'org').replace(/[^a-z0-9-]/gi, '-').slice(0, 40)
    const filename = `kasa-export-${safeSlug}-${new Date().toISOString().slice(0, 10)}.json`
    const body = JSON.stringify(bundle, null, 2)

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  },
})
