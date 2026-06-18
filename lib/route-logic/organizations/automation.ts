/**
 * Per-organization automation settings.
 *
 * GET  /api/organizations/automation — return the active org's automation config.
 * PUT  /api/organizations/automation — owner/admin updates the config.
 *
 * Currently exposed:
 *   - barMitzvahAutoAssignPlanId: ObjectId of the PaymentPlan to auto-assign
 *     when a male member reaches Bar Mitzvah age (Hebrew calendar). Null
 *     disables the auto-assign.
 *   - barMitzvahAutoCreateEventTypeId: ObjectId of the LifecycleEvent type
 *     whose configured amount is recorded as an event payment on the same
 *     trigger. Null disables auto-event-creation.
 *   - addChildAutoCreateEventTypeId: ObjectId of the LifecycleEvent type
 *     recorded when a child member is added to a family. Uses the child's
 *     birth date (or today if none) as the event date. Null disables.
 *   - weddingConversionDefaultPlanId: ObjectId of the PaymentPlan assigned
 *     to a newly converted family (wedding-date cron / manual convert).
 *     Null leaves the family unassigned for the admin to set manually.
 *   - monthlyStatementAutoGenerate: boolean opt-in for the cron at
 *     /api/jobs/generate-monthly-statements (runs on the 1st of each
 *     month). When false the cron skips this org.
 *   - monthlyStatementAutoEmail: boolean opt-in for the cron at
 *     /api/jobs/send-monthly-statements (runs daily, one hour after
 *     generate). Requires a saved email configuration to actually send.
 *   - monthlyStatementCalendar: 'gregorian' | 'hebrew'. Which calendar
 *     drives the schedule. Defaults to 'gregorian'.
 *   - monthlyStatementDay: integer 1–31. Day of the Gregorian month.
 *     Consulted only when `monthlyStatementCalendar === 'gregorian'`.
 *     When the current month has fewer days than this value (e.g. Feb 28
 *     vs day=31), the cron fires on the LAST day of the month so the
 *     org never gets skipped.
 *   - monthlyStatementHebrewDay: integer 1–30. Day of the Hebrew month.
 *     Consulted only when `monthlyStatementCalendar === 'hebrew'`. Same
 *     end-of-month clamp applies (29- vs 30-day Hebrew months).
 *
 * All fields are independent. The trigger code no-ops piecewise when any
 * of them is null / false.
 */

import { z } from 'zod'
import { Types } from 'mongoose'
import { handler } from '@/lib/api/handler'
import { Organization, PaymentPlan, LifecycleEvent } from '@/lib/models'
import { audit } from '@/lib/audit'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const putBody = z.object({
  barMitzvahAutoAssignPlanId: z.string().min(0).nullable().optional(),
  barMitzvahAutoCreateEventTypeId: z.string().min(0).nullable().optional(),
  addChildAutoCreateEventTypeId: z.string().min(0).nullable().optional(),
  weddingConversionDefaultPlanId: z.string().min(0).nullable().optional(),
  monthlyStatementAutoGenerate: z.boolean().optional(),
  monthlyStatementAutoEmail: z.boolean().optional(),
  monthlyStatementCalendar: z.enum(['gregorian', 'hebrew']).optional(),
  monthlyStatementDay: z.number().int().min(1).max(31).optional(),
  monthlyStatementHebrewDay: z.number().int().min(1).max(30).optional(),
})

const objectIdOrNull = (v: unknown): Types.ObjectId | null => {
  if (v == null || v === '') return null
  const s = String(v)
  return Types.ObjectId.isValid(s) ? new Types.ObjectId(s) : null
}

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/organizations/automation',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'org-automation-get',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const org = await Organization.findById(ctx!.organizationId)
      .select(
        'barMitzvahAutoAssignPlanId barMitzvahAutoCreateEventTypeId addChildAutoCreateEventTypeId weddingConversionDefaultPlanId monthlyStatementAutoGenerate monthlyStatementAutoEmail monthlyStatementCalendar monthlyStatementDay monthlyStatementHebrewDay',
      )
      .lean<any>()
    if (!org) return { status: 404, data: { error: 'Organization not found' } }
    return {
      data: {
        barMitzvahAutoAssignPlanId: org.barMitzvahAutoAssignPlanId
          ? String(org.barMitzvahAutoAssignPlanId)
          : null,
        barMitzvahAutoCreateEventTypeId: org.barMitzvahAutoCreateEventTypeId
          ? String(org.barMitzvahAutoCreateEventTypeId)
          : null,
        addChildAutoCreateEventTypeId: org.addChildAutoCreateEventTypeId
          ? String(org.addChildAutoCreateEventTypeId)
          : null,
        weddingConversionDefaultPlanId: org.weddingConversionDefaultPlanId
          ? String(org.weddingConversionDefaultPlanId)
          : null,
        monthlyStatementAutoGenerate: !!org.monthlyStatementAutoGenerate,
        monthlyStatementAutoEmail: !!org.monthlyStatementAutoEmail,
        monthlyStatementCalendar:
          org.monthlyStatementCalendar === 'hebrew' ? 'hebrew' : 'gregorian',
        monthlyStatementDay:
          typeof org.monthlyStatementDay === 'number' ? org.monthlyStatementDay : 1,
        monthlyStatementHebrewDay:
          typeof org.monthlyStatementHebrewDay === 'number' ? org.monthlyStatementHebrewDay : 1,
      },
    }
  },
})

export const PUT = handler({
  auth: 'org',
  minRole: 'admin',
  body: putBody,
  name: 'PUT /api/organizations/automation',
  fn: async ({ ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'org-automation-update',
      { limit: 10, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const update: Record<string, unknown> = {}
    const planTouched = body.barMitzvahAutoAssignPlanId !== undefined
    const eventTouched = body.barMitzvahAutoCreateEventTypeId !== undefined
    const addChildEventTouched = body.addChildAutoCreateEventTypeId !== undefined
    const weddingTouched = body.weddingConversionDefaultPlanId !== undefined
    const autoGenerateTouched = body.monthlyStatementAutoGenerate !== undefined
    const autoEmailTouched = body.monthlyStatementAutoEmail !== undefined
    const calendarTouched = body.monthlyStatementCalendar !== undefined
    const dayTouched = body.monthlyStatementDay !== undefined
    const hebrewDayTouched = body.monthlyStatementHebrewDay !== undefined

    if (
      !planTouched &&
      !eventTouched &&
      !addChildEventTouched &&
      !weddingTouched &&
      !autoGenerateTouched &&
      !autoEmailTouched &&
      !calendarTouched &&
      !dayTouched &&
      !hebrewDayTouched
    ) {
      return { status: 400, data: { error: 'Nothing to update.' } }
    }

    // Validate referenced docs belong to this org so we can't be tricked
    // into pointing at someone else's plan/event by id-guessing.
    if (planTouched) {
      const raw = body.barMitzvahAutoAssignPlanId
      if (raw != null && raw !== '' && !Types.ObjectId.isValid(String(raw))) {
        return { status: 400, data: { error: 'Invalid barMitzvahAutoAssignPlanId' } }
      }
      const planId = objectIdOrNull(body.barMitzvahAutoAssignPlanId)
      if (planId) {
        const exists = await PaymentPlan.exists({
          _id: planId,
          organizationId: ctx!.organizationId,
        })
        if (!exists) {
          return { status: 400, data: { error: 'Payment plan not found in this organization' } }
        }
      }
      update.barMitzvahAutoAssignPlanId = planId
    }
    if (eventTouched) {
      const raw = body.barMitzvahAutoCreateEventTypeId
      if (raw != null && raw !== '' && !Types.ObjectId.isValid(String(raw))) {
        return { status: 400, data: { error: 'Invalid barMitzvahAutoCreateEventTypeId' } }
      }
      const eventId = objectIdOrNull(body.barMitzvahAutoCreateEventTypeId)
      if (eventId) {
        const exists = await LifecycleEvent.exists({
          _id: eventId,
          organizationId: ctx!.organizationId,
        })
        if (!exists) {
          return {
            status: 400,
            data: { error: 'Lifecycle event type not found in this organization' },
          }
        }
      }
      update.barMitzvahAutoCreateEventTypeId = eventId
    }
    if (addChildEventTouched) {
      const raw = body.addChildAutoCreateEventTypeId
      if (raw != null && raw !== '' && !Types.ObjectId.isValid(String(raw))) {
        return { status: 400, data: { error: 'Invalid addChildAutoCreateEventTypeId' } }
      }
      const eventId = objectIdOrNull(body.addChildAutoCreateEventTypeId)
      if (eventId) {
        const exists = await LifecycleEvent.exists({
          _id: eventId,
          organizationId: ctx!.organizationId,
        })
        if (!exists) {
          return {
            status: 400,
            data: { error: 'Lifecycle event type not found in this organization' },
          }
        }
      }
      update.addChildAutoCreateEventTypeId = eventId
    }
    if (weddingTouched) {
      const raw = body.weddingConversionDefaultPlanId
      if (raw != null && raw !== '' && !Types.ObjectId.isValid(String(raw))) {
        return { status: 400, data: { error: 'Invalid weddingConversionDefaultPlanId' } }
      }
      const planId = objectIdOrNull(body.weddingConversionDefaultPlanId)
      if (planId) {
        const exists = await PaymentPlan.exists({
          _id: planId,
          organizationId: ctx!.organizationId,
        })
        if (!exists) {
          return { status: 400, data: { error: 'Payment plan not found in this organization' } }
        }
      }
      update.weddingConversionDefaultPlanId = planId
    }
    if (autoGenerateTouched) {
      update.monthlyStatementAutoGenerate = !!body.monthlyStatementAutoGenerate
    }
    if (autoEmailTouched) {
      update.monthlyStatementAutoEmail = !!body.monthlyStatementAutoEmail
    }
    if (calendarTouched) {
      update.monthlyStatementCalendar =
        body.monthlyStatementCalendar === 'hebrew' ? 'hebrew' : 'gregorian'
    }
    if (dayTouched) {
      // The Zod schema enforces 1–31; clamp defensively anyway.
      const d = Math.max(1, Math.min(31, Math.floor(body.monthlyStatementDay as number)))
      update.monthlyStatementDay = d
    }
    if (hebrewDayTouched) {
      // The Zod schema enforces 1–30; clamp defensively anyway.
      const d = Math.max(1, Math.min(30, Math.floor(body.monthlyStatementHebrewDay as number)))
      update.monthlyStatementHebrewDay = d
    }

    const org = await Organization.findByIdAndUpdate(
      ctx!.organizationId,
      { $set: update },
      { new: true },
    )
      .select(
        'barMitzvahAutoAssignPlanId barMitzvahAutoCreateEventTypeId addChildAutoCreateEventTypeId weddingConversionDefaultPlanId monthlyStatementAutoGenerate monthlyStatementAutoEmail monthlyStatementCalendar monthlyStatementDay monthlyStatementHebrewDay',
      )
      .lean<any>()

    if (!org) return { status: 404, data: { error: 'Organization not found' } }

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'organization.automation.update',
      resourceType: 'Organization',
      resourceId: ctx!.organizationId,
      metadata: {
        planTouched,
        eventTouched,
        addChildEventTouched,
        weddingTouched,
        autoGenerateTouched,
        autoEmailTouched,
        calendarTouched,
        dayTouched,
        hebrewDayTouched,
      },
      request,
    })

    return {
      data: {
        barMitzvahAutoAssignPlanId: org.barMitzvahAutoAssignPlanId
          ? String(org.barMitzvahAutoAssignPlanId)
          : null,
        barMitzvahAutoCreateEventTypeId: org.barMitzvahAutoCreateEventTypeId
          ? String(org.barMitzvahAutoCreateEventTypeId)
          : null,
        addChildAutoCreateEventTypeId: org.addChildAutoCreateEventTypeId
          ? String(org.addChildAutoCreateEventTypeId)
          : null,
        weddingConversionDefaultPlanId: org.weddingConversionDefaultPlanId
          ? String(org.weddingConversionDefaultPlanId)
          : null,
        monthlyStatementAutoGenerate: !!org.monthlyStatementAutoGenerate,
        monthlyStatementAutoEmail: !!org.monthlyStatementAutoEmail,
        monthlyStatementCalendar:
          org.monthlyStatementCalendar === 'hebrew' ? 'hebrew' : 'gregorian',
        monthlyStatementDay:
          typeof org.monthlyStatementDay === 'number' ? org.monthlyStatementDay : 1,
        monthlyStatementHebrewDay:
          typeof org.monthlyStatementHebrewDay === 'number' ? org.monthlyStatementHebrewDay : 1,
      },
    }
  },
})
