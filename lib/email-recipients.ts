import { OrgMembership, User, Family, FamilyMember } from '@/lib/models'

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function emailEqualsFilter(normalized: string) {
  return { $regex: new RegExp(`^${escapeRegExp(normalized)}$`, 'i') }
}

/** Outbound mail may only go to org members or family contacts in the org. */
export async function isAllowedOutboundRecipient(
  organizationId: string,
  to: string,
): Promise<boolean> {
  const normalized = normalizeEmail(to)
  if (!normalized) return false

  const memberUserIds = await OrgMembership.find({ organizationId }).distinct('userId')
  if (memberUserIds.length > 0) {
    const orgUser = await User.findOne({
      _id: { $in: memberUserIds },
      email: emailEqualsFilter(normalized),
    })
      .select('_id')
      .lean()
    if (orgUser) return true
  }

  const family = await Family.findOne({
    organizationId,
    email: emailEqualsFilter(normalized),
  })
    .select('_id')
    .lean()
  if (family) return true

  const member = await FamilyMember.findOne({
    organizationId,
    email: emailEqualsFilter(normalized),
  })
    .select('_id')
    .lean()
  return Boolean(member)
}
