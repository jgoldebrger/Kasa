/**
 * Shared Payment queries for year-end tax receipts.
 *
 * Receipts are membership-dues only. Year membership is determined by
 * `buildPaymentYearFilter` — `Payment.year` is the source of truth
 * (stamped in the org's wall-clock timezone at charge time), with a
 * `paymentDate` fallback for legacy rows missing `year`.
 */

import { Types } from 'mongoose'
import connectDB from '@/lib/database'
import { buildPaymentYearFilter } from '@/lib/calculations'
import { Organization } from '@/lib/models'

export async function membershipDuesYearFilter(
  year: number,
  organizationId: string,
  extra: Record<string, unknown> = {},
) {
  await connectDB()
  const org = await Organization.findById(organizationId)
    .select('timezone')
    .lean<{ timezone?: string }>()

  const orgId = Types.ObjectId.isValid(organizationId)
    ? new Types.ObjectId(organizationId)
    : organizationId
  return {
    ...buildPaymentYearFilter(year, String(organizationId), org?.timezone),
    organizationId: orgId,
    type: 'membership',
    // aggregate() bypasses Mongoose soft-delete hooks; exclude trashed
    // payments so tax-receipt eligibility matches Payment.find() paths.
    deletedAt: null,
    ...extra,
  }
}

/** Net major-unit amount credited on a tax receipt after refunds. */
export function netMembershipPaymentAmount(payment: {
  amount?: number | null
  refundedAmount?: number | null
}): number {
  return Math.max(
    0,
    Number(payment.amount || 0) - Number(payment.refundedAmount || 0),
  )
}
