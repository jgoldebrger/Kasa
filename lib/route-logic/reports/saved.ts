/**
 * GET  /api/reports/saved — list saved reports for the active org
 * POST /api/reports/saved — create a new saved report (current user is creator)
 */

import { handler } from '@/lib/api/handler'
import { SavedReport } from '@/lib/models'
import { audit } from '@/lib/audit'
import { validateDateRange } from '@/lib/validate-date-range'
import { checkRateLimit } from '@/lib/rate-limit'
import { report as reportSchemas } from '@/lib/schemas'
import { collectCompoundCursorPages } from '@/lib/pagination'

const createBody = reportSchemas.savedReportCreateBody
export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/reports/saved',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'reports-saved-list',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const rows = await collectCompoundCursorPages(
      (filter, limit) =>
        SavedReport.find(filter).sort({ updatedAt: -1, _id: -1 }).limit(limit).lean<any[]>(),
      { organizationId: ctx!.organizationId },
      'updatedAt',
      -1,
      (last) => ({
        v: last.updatedAt ? new Date(last.updatedAt as string | Date).getTime() : null,
        id: String(last._id),
      }),
    )
    return {
      data: {
        reports: rows.map((r) => ({
          _id: r._id.toString(),
          name: r.name,
          description: r.description || '',
          source: r.source,
          config: r.config || {},
          createdBy: r.createdBy?.toString() || null,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
      },
    }
  },
})

// admin+: saved reports are org-shared (per the schema comment), and
// the route enforces no per-user ownership on PUT/DELETE — without an
// admin gate any `member` role could overwrite or delete an admin's
// configured reports.
export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  body: createBody,
  name: 'POST /api/reports/saved',
  fn: async ({ ctx, session, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'saved-report-create',
      { limit: 20, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    if (body.config.fromDate || body.config.toDate) {
      if (!body.config.fromDate || !body.config.toDate) {
        return {
          status: 400,
          data: { error: 'Both fromDate and toDate are required in config' },
        }
      }
      const from = new Date(body.config.fromDate)
      const to = new Date(body.config.toDate)
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        return { status: 400, data: { error: 'Invalid fromDate or toDate in config' } }
      }
      if (from.getTime() > to.getTime()) {
        return {
          status: 400,
          data: { error: 'fromDate must be on or before toDate in config' },
        }
      }
      const rangeErr = validateDateRange(from, to)
      if (rangeErr) {
        return { status: 400, data: { error: rangeErr } }
      }
    }

    const doc = await SavedReport.create({
      organizationId: ctx!.organizationId,
      createdBy: session!.user.id,
      name: body.name,
      description: body.description || '',
      source: body.source,
      config: body.config,
    })

    await audit({
      organizationId: ctx!.organizationId,
      userId: session!.user.id,
      action: 'report.create',
      resourceType: 'SavedReport',
      resourceId: doc._id,
      metadata: { name: body.name, source: body.source },
      request,
    })

    return {
      status: 201,
      data: {
        _id: doc._id.toString(),
        name: doc.name,
        source: doc.source,
        config: doc.config,
      },
    }
  },
})
