import { Types } from 'mongoose'
import { Family, FamilyMember } from '@/lib/models'
import { calculateFamilyBalance } from '@/lib/calculations'
import { hasMinRole, type Role } from '@/lib/auth-helpers'
import { loadAllByIdCursor } from '@/lib/org-pagination'
import { normalizePlanId } from '@/lib/payment-plan-display'

const EMPTY_BALANCE = {
  openingBalance: 0,
  planCost: 0,
  totalPayments: 0,
  totalWithdrawals: 0,
  totalLifecyclePayments: 0,
  totalCycleCharges: 0,
  balance: 0,
}

export interface FamilySummaryPayload {
  family: Record<string, unknown>
  members: Record<string, unknown>[]
  payments: []
  withdrawals: []
  lifecycleEvents: []
  cycleCharges: []
  balance: typeof EMPTY_BALANCE
}

/**
 * Lightweight family payload for first paint — family, members, balance
 * summary only. Ledger arrays are always empty; tabs fetch their own data.
 */
export async function fetchFamilySummary(
  organizationId: string,
  familyId: string,
  role: Role,
): Promise<FamilySummaryPayload | null> {
  if (!Types.ObjectId.isValid(familyId)) return null

  const fam = await Family.findOne({ _id: familyId, organizationId })
  if (!fam) return null

  const isAdmin = hasMinRole(role, 'admin')
  const memberFilter = {
    familyId: fam._id,
    organizationId,
    convertedToFamily: { $ne: true },
  }

  const members = await loadAllByIdCursor<any>(
    (filter, limit) => FamilyMember.find(filter).sort({ _id: 1 }).limit(limit).lean<any[]>(),
    memberFilter,
  )

  if (!isAdmin) {
    const sanitizedMembers = members.map((m) => {
      const row = { ...m }
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
      family,
      members: sanitizedMembers,
      payments: [],
      withdrawals: [],
      lifecycleEvents: [],
      cycleCharges: [],
      balance: { ...EMPTY_BALANCE },
    }
  }

  const balance = await calculateFamilyBalance(fam._id.toString(), organizationId)

  const family = fam.toObject()
  if (family.paymentPlanId != null) {
    family.paymentPlanId = normalizePlanId(family.paymentPlanId)
  }

  return {
    family,
    members,
    payments: [],
    withdrawals: [],
    lifecycleEvents: [],
    cycleCharges: [],
    balance,
  }
}
