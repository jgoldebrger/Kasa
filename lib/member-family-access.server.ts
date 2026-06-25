import { Types } from 'mongoose'
import { Family, FamilyMember, User } from '@/lib/models'
import { hasMinRole, type Role } from '@/lib/auth-helpers'
import { userEmailMatchesFamily } from '@/lib/member-family-access'

export interface MemberFamilyAccessResult {
  allowed: boolean
  userEmail: string | null
}

/** Whether a non-admin may view this family's financial read-only data. */
export async function checkMemberFamilyFinancialAccess(
  organizationId: string,
  familyId: string,
  userId: string,
  role: Role,
): Promise<MemberFamilyAccessResult> {
  if (hasMinRole(role, 'admin')) {
    return { allowed: true, userEmail: null }
  }

  if (!Types.ObjectId.isValid(familyId)) {
    return { allowed: false, userEmail: null }
  }

  const user = await User.findById(userId).select('email').lean<{ email?: string }>()
  const userEmail = user?.email ?? null
  if (!userEmail) {
    return { allowed: false, userEmail: null }
  }

  const fam = await Family.findOne({ _id: familyId, organizationId })
    .select('email')
    .lean<{ email?: string }>()
  if (!fam) {
    return { allowed: false, userEmail }
  }

  const members = await FamilyMember.find({
    familyId,
    organizationId,
    convertedToFamily: { $ne: true },
  })
    .select('email')
    .lean<Array<{ email?: string }>>()

  return {
    allowed: userEmailMatchesFamily(userEmail, fam, members),
    userEmail,
  }
}

export type FamilyPaymentAccessResult = { ok: true } | { ok: false; status: number; error: string }

/** Admins always pass; members must be email-linked to the family. */
export async function requireFamilyPaymentAccess(
  organizationId: string,
  familyId: string,
  userId: string,
  role: Role,
): Promise<FamilyPaymentAccessResult> {
  if (hasMinRole(role, 'admin')) return { ok: true }
  const access = await checkMemberFamilyFinancialAccess(organizationId, familyId, userId, role)
  if (!access.allowed) {
    return { ok: false, status: 403, error: 'Payment access denied for this family' }
  }
  return { ok: true }
}
