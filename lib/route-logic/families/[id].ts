import { Types } from 'mongoose'
import { z } from 'zod'
import {
  Family,
  FamilyMember,
  Payment,
  Withdrawal,
  LifecycleEventPayment,
  PaymentPlan,
  CycleCharge,
} from '@/lib/models'
// Withdrawal is still imported above because the GET handler reads it; only the
// DELETE handler used to hard-delete it (now replaced by the cascade).
import { calculateFamilyBalance } from '@/lib/calculations'
import { hasMinRole } from '@/lib/auth-helpers'
import { audit } from '@/lib/audit'
import { handler } from '@/lib/api/handler'
import { family as familySchemas } from '@/lib/schemas'
import { softDeleteFamilyCascade } from '@/lib/recycle-bin'
import { PAYMENT_PUBLIC_SELECT, serializePaymentsPublic } from '@/lib/payments/select'
import { checkRateLimit } from '@/lib/rate-limit'
import { loadAllByIdCursor } from '@/lib/org-pagination'
import { collectCompoundCursorPages } from '@/lib/pagination'
import { fetchFamilySummary } from '@/lib/family-detail-summary'

const SUMMARY_CACHE_HEADERS = {
  'Cache-Control': 'private, max-age=15, stale-while-revalidate=60',
}

const getQuery = z.object({
  view: z.enum(['summary', 'full']).optional(),
})

// GET /api/families/[id] — family + members for all org roles; ledger
// detail (payments, balance, etc.) is admin-only.
// `?view=summary` returns family + members + balance only (fast path).
export const GET = handler({
  auth: 'org',
  idParams: ['id'],
  query: getQuery,
  name: 'GET /api/families/[id]',
  fn: async ({ params, ctx, request, query }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'family-detail',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const id = params.id as string
    /* v8 ignore next 3 -- idParams validates ObjectId before fn */
    if (!Types.ObjectId.isValid(id)) {
      return { status: 400, data: { error: 'Invalid family id' } }
    }

    if (query.view === 'summary') {
      const summary = await fetchFamilySummary(ctx!.organizationId, id, ctx!.role)
      if (!summary) return { status: 404, data: { error: 'Family not found' } }
      return { data: summary, headers: SUMMARY_CACHE_HEADERS }
    }

    const fam = await Family.findOne({ _id: id, organizationId: ctx!.organizationId })
    if (!fam) return { status: 404, data: { error: 'Family not found' } }

    const isAdmin = hasMinRole(ctx!.role, 'admin')

    const memberFilter = {
      familyId: fam._id,
      organizationId: ctx!.organizationId,
      convertedToFamily: { $ne: true },
    }

    if (!isAdmin) {
      const members = await loadAllByIdCursor<any>(
        (filter, limit) => FamilyMember.find(filter).sort({ _id: 1 }).limit(limit).lean<any[]>(),
        memberFilter,
      )
      const sanitizedMembers = members.map((m) => {
        const row = typeof m.toObject === 'function' ? m.toObject() : { ...m }
        delete (row as any).paymentPlanId
        delete (row as any).paymentPlan
        delete (row as any).paymentPlanAssigned
        return row
      })
      const family = fam.toObject()
      delete (family as any).openBalance
      delete (family as any).currentPayment
      delete (family as any).currentPlan
      delete (family as any).paymentPlanId
      return {
        data: {
          family,
          members: sanitizedMembers,
          payments: [],
          withdrawals: [],
          lifecycleEvents: [],
          cycleCharges: [],
          balance: {
            openingBalance: 0,
            planCost: 0,
            totalPayments: 0,
            totalWithdrawals: 0,
            totalLifecyclePayments: 0,
            totalCycleCharges: 0,
            balance: 0,
          },
        },
      }
    }

    const orgId = ctx!.organizationId
    const familyId = fam._id

    const [members, payments, withdrawals, lifecycleEvents, cycleCharges, balance] =
      await Promise.all([
        loadAllByIdCursor<any>(
          (filter, limit) => FamilyMember.find(filter).sort({ _id: 1 }).limit(limit).lean<any[]>(),
          memberFilter,
        ),
        collectCompoundCursorPages(
          (filter, limit) =>
            Payment.find(filter)
              .select(PAYMENT_PUBLIC_SELECT)
              .sort({ paymentDate: -1, _id: -1 })
              .limit(limit)
              .lean<any[]>(),
          { familyId, organizationId: orgId },
          'paymentDate',
          -1,
          (last) => ({
            v: last.paymentDate ? new Date(last.paymentDate as string | Date).getTime() : null,
            id: String(last._id),
          }),
        ),
        collectCompoundCursorPages(
          (filter, limit) =>
            Withdrawal.find(filter)
              .sort({ withdrawalDate: -1, _id: -1 })
              .limit(limit)
              .lean<any[]>(),
          { familyId, organizationId: orgId },
          'withdrawalDate',
          -1,
          (last) => ({
            v: last.withdrawalDate
              ? new Date(last.withdrawalDate as string | Date).getTime()
              : null,
            id: String(last._id),
          }),
        ),
        collectCompoundCursorPages(
          (filter, limit) =>
            LifecycleEventPayment.find(filter)
              .sort({ eventDate: -1, _id: -1 })
              .limit(limit)
              .lean<any[]>(),
          { familyId, organizationId: orgId },
          'eventDate',
          -1,
          (last) => ({
            v: last.eventDate ? new Date(last.eventDate as string | Date).getTime() : null,
            id: String(last._id),
          }),
        ),
        collectCompoundCursorPages(
          (filter, limit) =>
            CycleCharge.find(filter).sort({ chargeDate: -1, _id: -1 }).limit(limit).lean<any[]>(),
          { familyId, organizationId: orgId },
          'chargeDate',
          -1,
          (last) => ({
            v: last.chargeDate ? new Date(last.chargeDate as string | Date).getTime() : null,
            id: String(last._id),
          }),
        ),
        calculateFamilyBalance(fam._id.toString(), orgId),
      ])

    return {
      data: {
        family: fam.toObject(),
        members,
        payments: serializePaymentsPublic(payments),
        withdrawals,
        lifecycleEvents,
        cycleCharges,
        balance,
      },
    }
  },
})

// PUT /api/families/[id] — update (whitelisted fields via zod).
// Admin-only because the body can mutate financial fields (`openBalance`,
// `currentPayment`, `currentPlan`, `paymentPlanId`) and the family graph
// (`parentFamilyId`). Members get read-only access via GET.
export const PUT = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  body: familySchemas.familyUpdateBody,
  name: 'PUT /api/families/[id]',
  fn: async ({ params, ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'family-update',
      { limit: 60, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const id = params.id as string
    /* v8 ignore next 3 -- idParams validates ObjectId before fn */
    if (!Types.ObjectId.isValid(id)) {
      return { status: 400, data: { error: 'Invalid family id' } }
    }

    if (Object.keys(body).length === 0) {
      return { status: 400, data: { error: 'No fields to update' } }
    }

    const update: Record<string, unknown> = { ...body }

    // Validate paymentPlanId belongs to this org and keep legacy currentPlan in sync.
    if ('paymentPlanId' in body) {
      if (body.paymentPlanId) {
        const plan = await PaymentPlan.findOne({
          _id: body.paymentPlanId,
          organizationId: ctx!.organizationId,
        })
        if (!plan) {
          return { status: 400, data: { error: `Payment plan ${body.paymentPlanId} not found` } }
        }
        update.currentPlan = plan.planNumber
      }
    }

    // Tenant guard for `parentFamilyId`: must point at a family in the
    // same org. Without this, an admin could re-parent a family at an
    // arbitrary ObjectId — silently breaking the sub-family hierarchy
    // or pointing at another tenant's family id.
    if (body.parentFamilyId) {
      if (String(body.parentFamilyId) === String(id)) {
        return { status: 400, data: { error: 'A family cannot be its own parent' } }
      }
      const parent = await Family.findOne({
        _id: body.parentFamilyId,
        organizationId: ctx!.organizationId,
      }).select('_id')
      if (!parent) {
        return { status: 400, data: { error: `Parent family ${body.parentFamilyId} not found` } }
      }
    }

    const fam = await Family.findOneAndUpdate(
      { _id: id, organizationId: ctx!.organizationId },
      { $set: update },
      { new: true, runValidators: true },
    )
    if (!fam) return { status: 404, data: { error: 'Family not found' } }

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'family.update',
      resourceType: 'Family',
      resourceId: fam._id,
      metadata: { fields: Object.keys(body) },
      request,
    })

    return { data: fam }
  },
})

// DELETE /api/families/[id] — soft-deletes the family and cascades to its
// members, payments, statements, lifecycle events, related tasks, AND
// withdrawals. The items land in the org's recycle bin for 30 days, then
// auto-purge via the soft-delete plugin's TTL index. Restored families
// bring all their child rows back together (see `restoreFromBin`).
// Restricted to admins because the blast radius is large.
export const DELETE = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  name: 'DELETE /api/families/[id]',
  fn: async ({ params, ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'family-delete',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const id = params.id as string
    /* v8 ignore next 3 -- idParams validates ObjectId before fn */
    if (!Types.ObjectId.isValid(id)) {
      return { status: 400, data: { error: 'Invalid family id' } }
    }

    const result = await softDeleteFamilyCascade(id, ctx!, { request })
    if (!result) return { status: 404, data: { error: 'Family not found' } }

    return {
      data: { message: 'Family moved to recycle bin' },
    }
  },
})
