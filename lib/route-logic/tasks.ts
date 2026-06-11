import { Types } from 'mongoose'
import { Task, Family, FamilyMember, Payment, Organization } from '@/lib/models'
import { handler } from '@/lib/api/handler'
import { audit } from '@/lib/audit'
import { task as taskSchemas } from '@/lib/schemas'
import { checkRateLimit } from '@/lib/rate-limit'
import { calendarDayBoundsInTimeZone } from '@/lib/date-utils'
import { collectCompoundCursorPages } from '@/lib/pagination'

export const dynamic = 'force-dynamic'

const TASK_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const
const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const

/**
 * Validate that every related ObjectId on a task belongs to the active
 * org. Without this, a caller could store another tenant's familyId /
 * memberId / paymentId — Mongoose `populate()` then reads by `_id`
 * alone and leaks the other tenant's display name back on GET.
 */
async function assertRelatedScoped(
  organizationId: string,
  refs: {
    relatedFamilyId?: string | null
    relatedMemberId?: string | null
    relatedPaymentId?: string | null
  },
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (refs.relatedFamilyId) {
    if (!Types.ObjectId.isValid(refs.relatedFamilyId)) {
      return { ok: false, status: 400, error: 'Invalid relatedFamilyId' }
    }
    const fam = await Family.findOne({
      _id: refs.relatedFamilyId,
      organizationId,
    }).select('_id')
    if (!fam) return { ok: false, status: 404, error: 'Related family not found' }
  }
  if (refs.relatedMemberId) {
    if (!Types.ObjectId.isValid(refs.relatedMemberId)) {
      return { ok: false, status: 400, error: 'Invalid relatedMemberId' }
    }
    const mem = await FamilyMember.findOne({
      _id: refs.relatedMemberId,
      organizationId,
    }).select('_id')
    if (!mem) return { ok: false, status: 404, error: 'Related member not found' }
  }
  if (refs.relatedPaymentId) {
    if (!Types.ObjectId.isValid(refs.relatedPaymentId)) {
      return { ok: false, status: 400, error: 'Invalid relatedPaymentId' }
    }
    const pay = await Payment.findOne({
      _id: refs.relatedPaymentId,
      organizationId,
    }).select('_id')
    if (!pay) return { ok: false, status: 404, error: 'Related payment not found' }
  }
  return { ok: true }
}

export { assertRelatedScoped }

// GET /api/tasks — list tasks with optional filters.
export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/tasks',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'tasks-list',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const url = new URL(request.url)
    const status = url.searchParams.get('status')
    const priority = url.searchParams.get('priority')
    const dueDate = url.searchParams.get('dueDate')
    const relatedFamilyId = url.searchParams.get('relatedFamilyId')
    const relatedMemberId = url.searchParams.get('relatedMemberId')

    const query: Record<string, unknown> = { organizationId: ctx!.organizationId }
    if (status) {
      if (!(TASK_STATUSES as readonly string[]).includes(status)) {
        return { status: 400, data: { error: 'Invalid status filter' } }
      }
      query.status = status
    }
    if (priority) {
      if (!(TASK_PRIORITIES as readonly string[]).includes(priority)) {
        return { status: 400, data: { error: 'Invalid priority filter' } }
      }
      query.priority = priority
    }
    if (relatedFamilyId) {
      const scopeCheck = await assertRelatedScoped(ctx!.organizationId, {
        relatedFamilyId,
      })
      if (!scopeCheck.ok) {
        return { status: scopeCheck.status, data: { error: scopeCheck.error } }
      }
      query.relatedFamilyId = relatedFamilyId
    }
    if (relatedMemberId) {
      const scopeCheck = await assertRelatedScoped(ctx!.organizationId, {
        relatedMemberId,
      })
      if (!scopeCheck.ok) {
        return { status: scopeCheck.status, data: { error: scopeCheck.error } }
      }
      query.relatedMemberId = relatedMemberId
    }

    if (dueDate === 'today' || dueDate === 'overdue' || dueDate === 'upcoming') {
      const org = await Organization.findById(ctx!.organizationId).select('timezone').lean<{ timezone?: string }>()
      const { from, toExclusive } = calendarDayBoundsInTimeZone(org?.timezone)
      if (dueDate === 'today') {
        query.dueDate = { $gte: from, $lt: toExclusive }
      } else if (dueDate === 'overdue') {
        query.dueDate = { $lt: from }
        query.status = { $ne: 'completed' }
      } else {
        query.dueDate = { $gte: from }
      }
    }

    // Populate is org-safe here because every related document is also
    // org-scoped at write time (validated in POST/PUT); we additionally
    // filter the populated docs to the active org as defense-in-depth.
    const tasks = await collectCompoundCursorPages(
      (pageFilter, limit) =>
        Task.find(pageFilter)
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
          .sort({ dueDate: 1, priority: -1, _id: 1 })
          .limit(limit).lean(),
      query,
      'dueDate',
      1,
      (last) => ({
        v: last.dueDate ? new Date(last.dueDate as string | Date).getTime() : null,
        id: String(last._id),
      }),
    )

    return { data: tasks }
  },
})

// POST /api/tasks — create a new task (validated + tenant-scoped FKs).
//
// admin+: tasks are org-shared (no per-user ownership column), and the
// auto-creation paths (Stripe dispute webhook, recurring-payment decline)
// are all admin-tier triage items. The DELETE route requires admin
// already; matching the create avoids letting `member` role spam the
// admin task queue.
export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  body: taskSchemas.taskBody,
  name: 'POST /api/tasks',
  fn: async ({ ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'task-create',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const scopeCheck = await assertRelatedScoped(ctx!.organizationId, {
      relatedFamilyId: body.relatedFamilyId ?? undefined,
      relatedMemberId: body.relatedMemberId ?? undefined,
      relatedPaymentId: body.relatedPaymentId ?? undefined,
    })
    if (!scopeCheck.ok) {
      return { status: scopeCheck.status, data: { error: scopeCheck.error } }
    }

    const task = await Task.create({
      organizationId: ctx!.organizationId,
      title: body.title,
      description: body.description,
      dueDate: body.dueDate,
      email: body.email,
      status: body.status || 'pending',
      priority: body.priority || 'medium',
      relatedFamilyId: body.relatedFamilyId || undefined,
      relatedMemberId: body.relatedMemberId || undefined,
      relatedPaymentId: body.relatedPaymentId || undefined,
      notes: body.notes,
    })

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'task.create',
      resourceType: 'Task',
      resourceId: task._id,
      metadata: { title: body.title, dueDate: body.dueDate },
      request,
    })

    return { status: 201, data: task.toObject() }
  },
})
