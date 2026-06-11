/**
 * PUT    /api/reports/saved/:id — update an existing saved report
 * DELETE /api/reports/saved/:id — delete a saved report
 */

import { z } from 'zod'
import { Types } from 'mongoose'
import { handler } from '@/lib/api/handler'
import { SavedReport } from '@/lib/models'
import { validateDateRange } from '@/lib/validate-date-range'
import { audit } from '@/lib/audit'
import { checkRateLimit } from '@/lib/rate-limit'
import { report as reportSchemas } from '@/lib/schemas'

const updateBody = reportSchemas.savedReportUpdateBody
// admin+: see the matching POST route for the rationale. SavedReport
// rows are org-shared (no per-user ownership filter on the query),
// so without an admin gate any `member` role could clobber an
// admin's saved configuration.
export const PUT = handler({
  auth: 'org',
  minRole: 'admin',
  body: updateBody,
  name: 'PUT /api/reports/saved/:id',
  fn: async ({ ctx, session, params, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'saved-report-update',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const id = String(params.id || '')
    if (!Types.ObjectId.isValid(id)) {
      return { status: 400, data: { error: 'Invalid id' } }
    }

    const update: Record<string, unknown> = {}
    if (body.name !== undefined) update.name = body.name
    if (body.description !== undefined) update.description = body.description
    if (body.source !== undefined) update.source = body.source
    if (body.config !== undefined) {
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
      update.config = body.config
    }

    if (Object.keys(update).length === 0) {
      return { status: 400, data: { error: 'No fields to update' } }
    }

    const updated = await SavedReport.findOneAndUpdate(
      { _id: id, organizationId: ctx!.organizationId },
      { $set: update },
      { new: true },
    ).lean<any>()
    if (!updated) return { status: 404, data: { error: 'Report not found' } }

    await audit({
      organizationId: ctx!.organizationId,
      userId: session!.user.id,
      action: 'report.update',
      resourceType: 'SavedReport',
      resourceId: id,
      metadata: { fields: Object.keys(update) },
      request,
    })

    return {
      data: {
        _id: updated._id.toString(),
        name: updated.name,
        source: updated.source,
        config: updated.config,
      },
    }
  },
})

export const DELETE = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'DELETE /api/reports/saved/:id',
  fn: async ({ ctx, session, params, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'saved-report-delete',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const id = String(params.id || '')
    if (!Types.ObjectId.isValid(id)) {
      return { status: 400, data: { error: 'Invalid id' } }
    }
    const deleted = await SavedReport.findOneAndDelete({
      _id: id,
      organizationId: ctx!.organizationId,
    }).lean<{ _id: any; name?: string } | null>()
    if (!deleted) return { status: 404, data: { error: 'Report not found' } }

    await audit({
      organizationId: ctx!.organizationId,
      userId: session!.user.id,
      action: 'report.delete',
      resourceType: 'SavedReport',
      resourceId: id,
      metadata: { name: deleted.name },
      request,
    })

    return { data: { ok: true } }
  },
})
