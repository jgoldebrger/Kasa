import { Types } from 'mongoose'
import { Task } from '@/lib/models'
import { handler } from '@/lib/api/handler'
import { task as taskSchemas } from '@/lib/schemas'
import { softDeleteOne } from '@/lib/recycle-bin'
import { assertRelatedScoped } from '@/lib/route-logic/tasks'
import { PAYMENT_PUBLIC_SELECT } from '@/lib/payments/select'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

// GET /api/tasks/[id]
export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  name: 'GET /api/tasks/[id]',
  fn: async ({ params, ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'task-detail',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const id = params.id as string
    /* v8 ignore next 3 -- idParams validates ObjectId before fn */
    if (!Types.ObjectId.isValid(id)) {
      return { status: 400, data: { error: 'Invalid task id' } }
    }
    const task = await Task.findOne({ _id: id, organizationId: ctx!.organizationId })
      .populate({
        path: 'relatedFamilyId',
        select: 'name organizationId',
        match: { organizationId: ctx!.organizationId },
      })
      .populate({
        path: 'relatedMemberId',
        select: 'firstName lastName organizationId',
        match: { organizationId: ctx!.organizationId },
      })
      .populate({
        path: 'relatedPaymentId',
        select: PAYMENT_PUBLIC_SELECT,
        match: { organizationId: ctx!.organizationId },
      }).lean()
    if (!task) return { status: 404, data: { error: 'Task not found' } }
    return { data: task }
  },
})

// PUT /api/tasks/[id] — partial update.
//
// admin+: matches the rest of the tasks CRUD now that POST + DELETE
// both require admin. Editing a task can re-target it at a different
// family / payment, which is a triage action.
export const PUT = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  body: taskSchemas.taskUpdateBody,
  name: 'PUT /api/tasks/[id]',
  fn: async ({ params, ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'task-update',
      { limit: 60, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const id = params.id as string
    /* v8 ignore next 3 -- idParams validates ObjectId before fn */
    if (!Types.ObjectId.isValid(id)) {
      return { status: 400, data: { error: 'Invalid task id' } }
    }

    if (Object.keys(body).length === 0) {
      return { status: 400, data: { error: 'No fields to update' } }
    }

    // When the caller is rewriting the related-* foreign keys, re-validate
    // each one against the active org so a malicious body can't pivot a
    // task at another tenant's row.
    if (
      body.relatedFamilyId !== undefined ||
      body.relatedMemberId !== undefined ||
      body.relatedPaymentId !== undefined
    ) {
      const scopeCheck = await assertRelatedScoped(ctx!.organizationId, {
        relatedFamilyId: body.relatedFamilyId ?? undefined,
        relatedMemberId: body.relatedMemberId ?? undefined,
        relatedPaymentId: body.relatedPaymentId ?? undefined,
      })
      if (!scopeCheck.ok) {
        return { status: scopeCheck.status, data: { error: scopeCheck.error } }
      }
    }

    const update: Record<string, unknown> = { ...body }

    // Auto-stamp completedAt when transitioning to completed, unless the
    // caller explicitly set it (eg restoring an old record).
    if (body.status === 'completed' && body.completedAt === undefined) {
      update.completedAt = new Date()
    }
    if (body.status && body.status !== 'completed' && body.completedAt === null) {
      update.completedAt = null
    }

    const task = await Task.findOneAndUpdate(
      { _id: id, organizationId: ctx!.organizationId },
      update,
      { new: true, runValidators: true },
    )
      .populate({
        path: 'relatedFamilyId',
        select: 'name organizationId',
        match: { organizationId: ctx!.organizationId },
      })
      .populate({
        path: 'relatedMemberId',
        select: 'firstName lastName organizationId',
        match: { organizationId: ctx!.organizationId },
      })
      .populate({
        path: 'relatedPaymentId',
        select: PAYMENT_PUBLIC_SELECT,
        match: { organizationId: ctx!.organizationId },
      })
      .lean()

    if (!task) return { status: 404, data: { error: 'Task not found' } }
    return { data: task }
  },
})

// DELETE /api/tasks/[id] — soft-delete; restorable from /settings?tab=trash for 30 days.
export const DELETE = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  name: 'DELETE /api/tasks/[id]',
  fn: async ({ params, ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'task-delete',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const id = params.id as string
    /* v8 ignore next 3 -- idParams validates ObjectId before fn */
    if (!Types.ObjectId.isValid(id)) {
      return { status: 400, data: { error: 'Invalid task id' } }
    }
    const doc = await softDeleteOne('task', id, ctx!, { request })
    if (!doc) return { status: 404, data: { error: 'Task not found' } }
    return { data: { message: 'Task moved to recycle bin' } }
  },
})
