import { handler } from '@/lib/api/handler'
import { PaymentPlan, Family, FamilyMember } from '@/lib/models'
import { audit } from '@/lib/audit'
import { softDeleteOne } from '@/lib/recycle-bin'
import { payment as paymentSchemas } from '@/lib/schemas'
import { checkRateLimit } from '@/lib/rate-limit'

// GET - Get payment plan by ID
export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  name: 'GET /api/payment-plans/[id]',
  fn: async ({ params, ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'payment-plan-detail',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const plan = await PaymentPlan.findOne({ _id: params.id, organizationId: ctx!.organizationId })

    if (!plan) {
      return { status: 404, data: { error: 'Payment plan not found' } }
    }

    return { data: plan }
  },
})

// PUT - Update payment plan
export const PUT = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  body: paymentSchemas.paymentPlanUpdateBody,
  name: 'PUT /api/payment-plans/[id]',
  fn: async ({ params, ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'payment-plan-update',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    if (Object.keys(body).length === 0) {
      return { status: 400, data: { error: 'Nothing to update.' } }
    }

    const update: Record<string, unknown> = { ...body }

    const plan = await PaymentPlan.findOneAndUpdate(
      { _id: params.id, organizationId: ctx!.organizationId },
      { $set: update },
      { new: true, runValidators: true },
    )

    if (!plan) {
      return { status: 404, data: { error: 'Payment plan not found' } }
    }

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'payment_plan.update',
      resourceType: 'PaymentPlan',
      resourceId: plan._id,
      metadata: { fields: Object.keys(update), update },
      request,
    })

    return { data: plan }
  },
})

// DELETE - Move payment plan to the recycle bin (restorable for 30 days).
export const DELETE = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  name: 'DELETE /api/payment-plans/[id]',
  fn: async ({ params, ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'payment-plan-delete',
      { limit: 20, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    // Read the plan first so we can include its name/price in the audit log.
    const existing: any = await PaymentPlan.findOne({
      _id: params.id,
      organizationId: ctx!.organizationId,
    })
    if (!existing) {
      return { status: 404, data: { error: 'Payment plan not found' } }
    }

    // Block deletion while any family OR member is still pointing at
    // this plan. Without this check, `calculateFamilyBalance` would
    // silently resolve the (soft-deleted) plan to `null` via the
    // soft-delete plugin's hidden-from-find filter, set `planCost = 0`,
    // and every affected family's balance would silently drop their
    // annual dues. Admin needs to reassign first, then delete.
    const [familyCount, memberCount] = await Promise.all([
      Family.countDocuments({
        organizationId: ctx!.organizationId,
        paymentPlanId: params.id,
      }),
      FamilyMember.countDocuments({
        organizationId: ctx!.organizationId,
        paymentPlanId: params.id,
      }),
    ])
    if (familyCount > 0 || memberCount > 0) {
      return {
        status: 409,
        data: {
          error: 'Cannot delete a payment plan that is still assigned',
          familyCount,
          memberCount,
        },
      }
    }

    const doc = await softDeleteOne('paymentPlan', params.id as string, ctx!, {
      metadata: { name: existing.name, yearlyPrice: existing.yearlyPrice },
      request,
    })

    if (!doc) {
      return { status: 404, data: { error: 'Payment plan not found' } }
    }

    return { data: { message: 'Payment plan moved to recycle bin' } }
  },
})
