/**
 * PATCH  /api/reports/schedules/:id — update or disable a schedule
 * DELETE /api/reports/schedules/:id — remove a schedule
 */

import { Types } from 'mongoose'
import { handler } from '@/lib/api/handler'
import { ScheduledReport } from '@/lib/models'
import { checkRateLimit } from '@/lib/rate-limit'
import { report as reportSchemas } from '@/lib/schemas'
import { computeNextRunAt } from '@/lib/reports/scheduled-report-utils'

export const PATCH = handler({
  auth: 'org',
  minRole: 'admin',
  body: reportSchemas.scheduledReportUpdateBody,
  name: 'PATCH /api/reports/schedules/:id',
  fn: async ({ ctx, params, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'reports-schedules-update',
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
    if (body.frequency !== undefined) {
      update.frequency = body.frequency
      update.nextRunAt = computeNextRunAt(body.frequency)
    }
    if (body.recipientEmail !== undefined) {
      update.recipientEmail = body.recipientEmail?.trim() || null
    }
    if (body.enabled !== undefined) update.enabled = body.enabled

    if (Object.keys(update).length === 0) {
      return { status: 400, data: { error: 'No fields to update' } }
    }

    const updated = await ScheduledReport.findOneAndUpdate(
      { _id: id, organizationId: ctx!.organizationId },
      { $set: update },
      { new: true },
    ).lean<any>()
    if (!updated) return { status: 404, data: { error: 'Schedule not found' } }

    return {
      data: {
        _id: String(updated._id),
        frequency: updated.frequency,
        enabled: updated.enabled,
        nextRunAt: updated.nextRunAt,
      },
    }
  },
})

export const DELETE = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'DELETE /api/reports/schedules/:id',
  fn: async ({ ctx, params, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'reports-schedules-delete',
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

    const deleted = await ScheduledReport.findOneAndDelete({
      _id: id,
      organizationId: ctx!.organizationId,
    })
    if (!deleted) return { status: 404, data: { error: 'Schedule not found' } }

    return { data: { ok: true } }
  },
})
