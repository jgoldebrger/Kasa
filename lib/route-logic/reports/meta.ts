/**
 * GET /api/reports/meta — static metadata for the report builder UI.
 *
 * Exposes the list of sources and their available dimensions / measures
 * so the UI can render select dropdowns without us shipping the whole
 * report engine to the client.
 */

import { handler } from '@/lib/api/handler'
import { REPORT_SOURCES } from '@/lib/report-builder'
import { checkRateLimit } from '@/lib/rate-limit'

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  noDb: true,
  name: 'GET /api/reports/meta',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'reports-meta',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    return {
    data: { sources: REPORT_SOURCES },
    headers: { 'Cache-Control': 'private, max-age=300' },
    }
  },
})
