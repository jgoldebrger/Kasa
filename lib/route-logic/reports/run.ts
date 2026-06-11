/**
 * POST /api/reports/run — execute a pivot config against the active
 * org's data and return the resulting table.
 *
 * Why POST and not GET? Configurations are non-trivial JSON (filters,
 * dimensions, date ranges) and we don't want them ending up in URL
 * histories / referer headers / proxy logs. The endpoint is read-only
 * server-side regardless of the method.
 */

import { handler } from '@/lib/api/handler'
import { runReport } from '@/lib/report-builder'
import { validateDateRange } from '@/lib/validate-date-range'
import { checkRateLimit } from '@/lib/rate-limit'
import { report as reportSchemas } from '@/lib/schemas'

export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  body: reportSchemas.reportRunBody,
  name: 'POST /api/reports/run',
  fn: async ({ ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'reports-run',
      { limit: 20, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    if (body.fromDate || body.toDate) {
      if (!body.fromDate || !body.toDate) {
        return {
          status: 400,
          data: { error: 'Both fromDate and toDate are required for a date range' },
        }
      }
      const from = new Date(body.fromDate)
      const to = new Date(body.toDate)
      const rangeErr = validateDateRange(from, to)
      if (rangeErr) {
        return { status: 400, data: { error: rangeErr } }
      }
    }

    const result = await runReport(body, ctx!.organizationId)
    return { data: result }
  },
})
