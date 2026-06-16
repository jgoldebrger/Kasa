import { Types } from 'mongoose'
import { handler } from '@/lib/api/handler'
import { PaymentPlan, Family } from '@/lib/models'
import { audit } from '@/lib/audit'
import { payment as paymentSchemas } from '@/lib/schemas'
import { checkRateLimit } from '@/lib/rate-limit'
import { loadAllByIdCursor, familyBatches } from '@/lib/org-pagination'

const CACHE_HEADERS = { 'Cache-Control': 'private, max-age=60' }

// GET - Get all payment plans with family counts
export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/payment-plans',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'payment-plans-list',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    // 1) Lean plan list.
    const plans = await loadAllByIdCursor<any>(
      (filter, limit) =>
        PaymentPlan.find(filter).sort({ planNumber: 1, _id: 1 }).limit(limit).lean<any[]>(),
      { organizationId: ctx!.organizationId },
    )

    if (plans.length === 0) {
      return { data: [], headers: CACHE_HEADERS }
    }

    const planIdSet = new Set(plans.map((p) => String(p._id)))
    const byPlan = new Map<string, any[]>()
    for await (const batch of familyBatches(ctx!.organizationId, {
      select: '_id name weddingDate paymentPlanId',
    })) {
      for (const f of batch) {
        const key = f.paymentPlanId ? String(f.paymentPlanId) : ''
        if (!key || !planIdSet.has(key)) continue
        if (!byPlan.has(key)) byPlan.set(key, [])
        byPlan.get(key)!.push({
          _id: String(f._id),
          name: f.name,
          weddingDate: (f as any).weddingDate,
        })
      }
    }

    const out = plans.map((planObj) => {
      const planFamilies = byPlan.get(String(planObj._id)) || []
      return {
        _id: planObj._id?.toString() || planObj._id,
        name: planObj.name,
        yearlyPrice: planObj.yearlyPrice,
        planNumber: planObj.planNumber,
        createdAt: planObj.createdAt,
        updatedAt: planObj.updatedAt,
        familyCount: planFamilies.length,
        families: planFamilies,
      }
    })

    return { data: out, headers: CACHE_HEADERS }
  },
})

// POST - Create a new payment plan
export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  body: paymentSchemas.paymentPlanBody,
  name: 'POST /api/payment-plans',
  fn: async ({ ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'payment-plan-create',
      { limit: 20, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const { name, yearlyPrice, planNumber } = body

    // If planNumber not provided, auto-assign based on existing plans
    let finalPlanNumber = planNumber
    if (!finalPlanNumber) {
      const maxAgg = await PaymentPlan.aggregate([
        { $match: { organizationId: new Types.ObjectId(String(ctx!.organizationId)) } },
        { $group: { _id: null, max: { $max: '$planNumber' } } },
      ])
      const maxPlanNumber = Number(maxAgg[0]?.max || 0)
      finalPlanNumber = maxPlanNumber > 0 ? maxPlanNumber + 1 : 1
    }

    const plan = await PaymentPlan.create({
      name,
      yearlyPrice,
      planNumber: finalPlanNumber,
      organizationId: ctx!.organizationId,
    })

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'payment_plan.create',
      resourceType: 'PaymentPlan',
      resourceId: plan._id,
      metadata: { name, yearlyPrice, planNumber: finalPlanNumber },
      request,
    })

    return { status: 201, data: plan }
  },
})
