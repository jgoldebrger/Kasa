import connectDB from '@/lib/database'
import { Invite, Organization, OrgMembership, User } from '@/lib/models'
import { audit } from '@/lib/audit'
import { getOidcConfig } from '@/lib/oidc-config'
import type { Role } from '@/types/auth'

export type OidcProvisionInput = {
  email: string
  name?: string | null
  image?: string | null
}

export type OidcProvisionResult =
  | { ok: true; userId: string; created: boolean }
  | { ok: false; reason: 'missing_email' | 'not_provisioned' }

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function emailDomain(email: string): string {
  const at = email.lastIndexOf('@')
  return at >= 0 ? email.slice(at + 1) : ''
}

async function findPendingInvite(email: string) {
  return Invite.findOne({
    email,
    acceptedAt: null,
    expiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: -1 })
    .lean<{
      _id: { toString(): string }
      organizationId: { toString(): string }
      role: Role
      email: string
    }>()
}

async function resolveOrgFromDomainMap(
  email: string,
): Promise<{ orgId: string; slug: string } | null> {
  const config = getOidcConfig()
  if (!config) return null
  const slug = config.domainOrgMap.get(emailDomain(email))
  if (!slug) return null
  const org = await Organization.findOne({ slug })
    .select('_id slug')
    .lean<{ _id: { toString(): string }; slug: string }>()
  if (!org) return null
  return { orgId: org._id.toString(), slug: org.slug }
}

async function ensureMembership(userId: string, organizationId: string, role: Role): Promise<void> {
  await OrgMembership.findOneAndUpdate(
    { userId, organizationId },
    { userId, organizationId, role },
    { upsert: true, new: true },
  )
  await User.findByIdAndUpdate(userId, { lastActiveOrganizationId: organizationId })
}

/**
 * JIT provision or link an OIDC user on first SSO sign-in.
 *
 * v1 rules:
 * - Existing users: allow sign-in; add membership when a pending invite or
 *   domain map matches.
 * - New users: require a pending invite OR a domain→org env mapping.
 * - Manual org invites remain the primary onboarding path when no domain map
 *   is configured.
 */
export async function provisionOidcUser(input: OidcProvisionInput): Promise<OidcProvisionResult> {
  const email = normalizeEmail(input.email)
  if (!email) return { ok: false, reason: 'missing_email' }

  await connectDB()

  const displayName = (input.name?.trim() || email.split('@')[0] || 'User').slice(0, 200)
  const pendingInvite = await findPendingInvite(email)
  const domainOrg = await resolveOrgFromDomainMap(email)

  let user = await User.findOne({ email }).lean<{
    _id: { toString(): string }
    email: string
    name?: string
  }>()

  let created = false

  if (!user) {
    if (!pendingInvite && !domainOrg) {
      return { ok: false, reason: 'not_provisioned' }
    }

    const doc = await User.create({
      email,
      name: displayName,
      emailVerified: new Date(),
      image: input.image || undefined,
    })
    user = { _id: doc._id, email: doc.email, name: doc.name }
    created = true
  } else {
    const updates: Record<string, unknown> = {}
    if (input.image && !updates.image) updates.image = input.image
    if (!user.name && displayName) updates.name = displayName
    updates.emailVerified = new Date()
    if (Object.keys(updates).length > 0) {
      await User.findByIdAndUpdate(user._id, { $set: updates })
    }
  }

  const userId = user._id.toString()

  if (pendingInvite) {
    const marked = await Invite.findOneAndUpdate(
      { _id: pendingInvite._id, acceptedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { acceptedAt: new Date() } },
    )
    if (marked) {
      await ensureMembership(userId, pendingInvite.organizationId.toString(), pendingInvite.role)
      await audit({
        organizationId: pendingInvite.organizationId.toString(),
        userId,
        action: 'invite.accept',
        resourceType: 'OrgMembership',
        metadata: { email, role: pendingInvite.role, via: 'oidc' },
      }).catch(() => {})
    }
  } else if (domainOrg) {
    await ensureMembership(userId, domainOrg.orgId, 'member')
  } else if (created) {
    // Should not happen — guarded above.
    return { ok: false, reason: 'not_provisioned' }
  }

  const memberships = await OrgMembership.countDocuments({ userId })
  if (memberships === 0) {
    return { ok: false, reason: 'not_provisioned' }
  }

  await audit({
    userId,
    action: 'auth.sso.login',
    resourceType: 'User',
    resourceId: userId,
    metadata: { email, created, provider: 'oidc' },
  }).catch(() => {})

  return { ok: true, userId, created }
}
