import { z } from 'zod'
import { handler } from '@/lib/api/handler'
import { checkRateLimit } from '@/lib/rate-limit'
import { objectId } from '@/lib/schemas'
import { buildBatchChargePreview } from '@/lib/payments/batch-charge-candidates'
import { chargeFamilySavedCard } from '@/lib/payments/charge-family-saved-card'
import { enforceMemberChargeGate } from '@/lib/billing/feature-gate'

export const dynamic = 'force-dynamic'

const batchChargeBody = z.object({
  charges: z
    .array(
      z.object({
        familyId: objectId,
        reason: z.enum(['recurring_due', 'negative_balance']),
        recurringPaymentId: objectId.optional(),
      }),
    )
    .min(1)
    .max(200),
})

function matchesCandidate(
  sel: { familyId: string; reason: string; recurringPaymentId?: string },
  c: { familyId: string; reason: string; recurringPaymentId?: string },
) {
  return (
    sel.familyId === c.familyId &&
    sel.reason === c.reason &&
    (sel.recurringPaymentId || '') === (c.recurringPaymentId || '')
  )
}

// GET /api/payments/batch-charge — preview chargeable families (read-only).
export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/payments/batch-charge',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'payments-batch-charge-preview',
      { limit: 30, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const preview = await buildBatchChargePreview(ctx!.organizationId)
    return { data: preview }
  },
})

// POST /api/payments/batch-charge — charge selected families via saved cards.
export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  body: batchChargeBody,
  name: 'POST /api/payments/batch-charge',
  fn: async ({ ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'payments-batch-charge',
      { limit: 5, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const billingGate = await enforceMemberChargeGate(ctx!.organizationId)
    if (!billingGate.ok) {
      return { status: billingGate.status, data: { error: billingGate.error } }
    }

    const preview = await buildBatchChargePreview(ctx!.organizationId)
    const toCharge = preview.candidates.filter((c) =>
      body.charges.some((sel) => matchesCandidate(sel, c)),
    )

    if (toCharge.length === 0) {
      return { status: 400, data: { error: 'No chargeable families matched the selection' } }
    }

    const results: Array<{
      familyId: string
      familyName: string
      amount: number
      reason: string
      status: 'success' | 'failed'
      paymentId?: string
      error?: string
    }> = []

    let succeeded = 0
    let failed = 0
    let totalCharged = 0

    for (const item of toCharge) {
      const charge = await chargeFamilySavedCard({
        organizationId: ctx!.organizationId,
        userId: ctx!.userId,
        familyId: item.familyId,
        savedPaymentMethodId: item.savedPaymentMethodId,
        amount: item.amount,
        notes:
          item.reason === 'recurring_due'
            ? 'Batch charge — due recurring payment'
            : 'Batch charge — negative balance',
        recurringPaymentId: item.recurringPaymentId,
        advanceRecurringSchedule: item.reason === 'recurring_due',
        idempotencyPrefix:
          item.reason === 'recurring_due' ? 'pi-batch-recurring' : 'pi-batch-balance',
        request,
      })

      if (charge.ok) {
        succeeded++
        totalCharged += item.amount
        results.push({
          familyId: item.familyId,
          familyName: item.familyName,
          amount: item.amount,
          reason: item.reason,
          status: 'success',
          paymentId: charge.paymentId,
        })
      } else {
        failed++
        results.push({
          familyId: item.familyId,
          familyName: item.familyName,
          amount: item.amount,
          reason: item.reason,
          status: 'failed',
          error: charge.error,
        })
      }
    }

    return {
      data: {
        succeeded,
        failed,
        totalCharged,
        results,
      },
    }
  },
})
