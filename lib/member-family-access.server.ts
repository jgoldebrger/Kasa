import { Types } from 'mongoose'
import { Family, FamilyMember, User } from '@/lib/models'
import { hasMinRole, type Role } from '@/lib/auth-helpers'
import { normalizeMemberEmail, userEmailMatchesFamily } from '@/lib/member-family-access'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function emailEqualsFilter(normalized: string) {
  return { $regex: new RegExp(`^${escapeRegExp(normalized)}$`, 'i') }
}

export interface AssignedFamilySummary {
  id: string
  name: string
}

/** Families linked to the signed-in user by email (family or member record). */
export async function listAssignedFamiliesForUser(
  organizationId: string,
  userId: string,
): Promise<{ families: AssignedFamilySummary[]; familyIds: Types.ObjectId[] }> {
  const user = await User.findById(userId).select('email').lean<{ email?: string }>()
  const norm = normalizeMemberEmail(user?.email)
  if (!norm) {
    return { families: [], familyIds: [] }
  }

  const orgOid = new Types.ObjectId(String(organizationId))
  const emailFilter = emailEqualsFilter(norm)

  const [directFamilies, memberFamilyIds] = await Promise.all([
    Family.find({ organizationId: orgOid, email: emailFilter })
      .select('_id name')
      .lean<Array<{ _id: unknown; name?: string }>>(),
    FamilyMember.find({
      organizationId: orgOid,
      email: emailFilter,
      convertedToFamily: { $ne: true },
    }).distinct('familyId'),
  ])

  const idToName = new Map<string, string>()
  for (const f of directFamilies) {
    idToName.set(String(f._id), typeof f.name === 'string' ? f.name : '')
  }

  const missingIds = memberFamilyIds.map((id) => String(id)).filter((id) => !idToName.has(id))

  if (missingIds.length > 0) {
    const extra = await Family.find({
      _id: { $in: missingIds.map((id) => new Types.ObjectId(id)) },
      organizationId: orgOid,
    })
      .select('_id name')
      .lean<Array<{ _id: unknown; name?: string }>>()
    for (const f of extra) {
      idToName.set(String(f._id), typeof f.name === 'string' ? f.name : '')
    }
  }

  const families = Array.from(idToName.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    families,
    familyIds: families.map((f) => new Types.ObjectId(f.id)),
  }
}

/** Member-role org stats: assigned families and their members only. */
export async function countAssignedFamilyStats(
  organizationId: string,
  userId: string,
): Promise<{ totalFamilies: number; totalMembers: number }> {
  const { familyIds } = await listAssignedFamiliesForUser(organizationId, userId)
  if (familyIds.length === 0) {
    return { totalFamilies: 0, totalMembers: 0 }
  }
  const totalMembers = await FamilyMember.countDocuments({
    organizationId: new Types.ObjectId(String(organizationId)),
    familyId: { $in: familyIds },
    convertedToFamily: { $ne: true },
  })
  return { totalFamilies: familyIds.length, totalMembers }
}

/** Non-admins may only open families assigned by email link. */
export async function requireMemberFamilyViewAccess(
  organizationId: string,
  familyId: string,
  userId: string,
  role: Role,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (hasMinRole(role, 'admin')) return { ok: true }
  const access = await checkMemberFamilyFinancialAccess(organizationId, familyId, userId, role)
  if (!access.allowed) {
    return { ok: false, status: 404, error: 'Family not found' }
  }
  return { ok: true }
}

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
