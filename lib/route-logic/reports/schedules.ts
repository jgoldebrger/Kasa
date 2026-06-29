/**
 * GET  /api/reports/schedules — list scheduled report emails
 * POST /api/reports/schedules — create a schedule for a saved report
 */

import { handler } from '@/lib/api/handler'
import { ScheduledReport, SavedReport } from '@/lib/models'
import { checkRateLimit } from '@/lib/rate-limit'
import { report as reportSchemas } from '@/lib/schemas'
import { computeNextRunAt } from '@/lib/reports/scheduled-report-utils'

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/reports/schedules',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'reports-schedules-list',
      { limit: 60, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const rows = await ScheduledReport.find({ organizationId: ctx!.organizationId })
      .sort({ createdAt: -1 })
      .lean<any[]>()

    const reportIds = rows.map((r) => r.savedReportId).filter(Boolean)
    const reports = await SavedReport.find({
      _id: { $in: reportIds },
      organizationId: ctx!.organizationId,
    })
      .select('name source')
      .lean<any[]>()
    const nameById = new Map(reports.map((r) => [String(r._id), r]))

    return {
      data: {
        schedules: rows.map((s) => {
          const saved = nameById.get(String(s.savedReportId))
          return {
            _id: String(s._id),
            savedReportId: String(s.savedReportId),
            reportName: saved?.name || '(deleted)',
            reportSource: saved?.source || null,
            frequency: s.frequency,
            recipientEmail: s.recipientEmail || null,
            enabled: s.enabled !== false,
            lastRunAt: s.lastRunAt || null,
            nextRunAt: s.nextRunAt,
            lastError: s.lastError || null,
          }
        }),
      },
    }
  },
})

export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  body: reportSchemas.scheduledReportCreateBody,
  name: 'POST /api/reports/schedules',
  fn: async ({ ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'reports-schedules-create',
      { limit: 20, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const saved = await SavedReport.findOne({
      _id: body.savedReportId,
      organizationId: ctx!.organizationId,
    }).lean()
    if (!saved) {
      return { status: 404, data: { error: 'Saved report not found' } }
    }

    const nextRunAt = computeNextRunAt(body.frequency)
    const doc = await ScheduledReport.create({
      organizationId: ctx!.organizationId,
      savedReportId: body.savedReportId,
      frequency: body.frequency,
      recipientEmail: body.recipientEmail?.trim() || undefined,
      enabled: body.enabled ?? true,
      nextRunAt,
    })

    return {
      status: 201,
      data: {
        _id: String(doc._id),
        savedReportId: String(doc.savedReportId),
        frequency: doc.frequency,
        nextRunAt: doc.nextRunAt,
      },
    }
  },
})
