import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { Types } from 'mongoose'
import { auth } from '@/app/auth'
import connectDB from '@/lib/database'
import { OrgMembership, Organization, User } from '@/lib/models'
import type { Role, SessionMembership } from '@/types/auth'

export type { Role, SessionMembership } from '@/types/auth'
export const ACTIVE_ORG_COOKIE = 'kasa_active_org'

const ROLE_RANK: Record<Role, number> = {
  member: 1,
  admin: 2,
  owner: 3,
}

/** True when `role` meets or exceeds `minRole` in the org hierarchy. */
export function hasMinRole(role: Role, minRole: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minRole]
}

export interface AuthedSession {
  user: { id: string; email: string; name: string; memberships?: SessionMembership[] }
}

export interface OrgContext {
  session: AuthedSession
  userId: string
  organizationId: string
  role: Role
  /** True for CRON_SECRET-authenticated synthetic context — not a real org role. */
  isCron?: boolean
}

/** Role check for handler/route logic. Cron context never satisfies admin/owner gates. */
export function contextHasMinRole(
  ctx: Pick<OrgContext, 'role' | 'isCron'>,
  minRole: Role,
): boolean {
  if (ctx.isCron) return false
  return hasMinRole(ctx.role, minRole)
}

function unauthorized(message = 'Not authenticated') {
  return NextResponse.json({ error: message }, { status: 401 })
}

function forbidden(message = 'Forbidden') {
  return NextResponse.json({ error: message }, { status: 403 })
}

/**
 * Require an authenticated session. Returns the session or a 401 response.
 * Always check `instanceof NextResponse` on the result.
 */
export async function requireSession(): Promise<AuthedSession | NextResponse> {
  const session = await auth()
  if (!session?.user?.id) {
    return unauthorized()
  }
  return {
    user: {
      id: session.user.id,
      email: session.user.email || '',
      name: session.user.name || '',
      memberships: session.user.memberships || [],
    },
  }
}

/**
 * Resolve the active organization for the current request.
 * Priority: x-organization-id header → cookie → user's lastActiveOrganizationId → first membership.
 * Returns the orgId or null if the user has no orgs.
 */
export async function getCurrentOrgId(
  request?: NextRequest,
  userId?: string,
): Promise<string | null> {
  let candidate: string | null = null

  if (request) {
    const headerOrg = request.headers.get('x-organization-id')?.trim()
    if (headerOrg) {
      candidate = headerOrg
    }
  }

  if (!candidate) {
    try {
      const cookieStore = await cookies()
      candidate = cookieStore.get(ACTIVE_ORG_COOKIE)?.value || null
    } catch {
      // cookies() not available outside request context
    }
  }

  if (!candidate && userId) {
    await connectDB()
    const user = await User.findById(userId).select('lastActiveOrganizationId').lean<{
      lastActiveOrganizationId?: Types.ObjectId
    }>()
    if (user?.lastActiveOrganizationId) {
      candidate = user.lastActiveOrganizationId.toString()
    } else {
      const membership = await OrgMembership.findOne({ userId }).select('organizationId').lean<{
        organizationId: Types.ObjectId
      }>()
      if (membership) {
        candidate = membership.organizationId.toString()
      }
    }
  }

  return candidate
}

/**
 * Require the user to belong to the given organization (or the active one)
 * with at least the specified role. Returns OrgContext or a NextResponse error.
 *
 * Usage in API routes:
 *   const ctx = await requireOrg(req)
 *   if (ctx instanceof NextResponse) return ctx
 *   await Family.find({ organizationId: ctx.organizationId })
 */
export async function requireOrg(
  request?: NextRequest,
  options: { minRole?: Role; orgId?: string } = {},
): Promise<OrgContext | NextResponse> {
  const sessionOrErr = await requireSession()
  if (sessionOrErr instanceof NextResponse) return sessionOrErr
  const session = sessionOrErr

  await connectDB()

  const orgId = options.orgId || (await getCurrentOrgId(request, session.user.id))
  if (!orgId) {
    return NextResponse.json({ error: 'No active organization' }, { status: 400 })
  }
  if (!Types.ObjectId.isValid(orgId)) {
    return NextResponse.json({ error: 'Invalid organization id' }, { status: 400 })
  }

  // Fast path: JWT memberships (refreshed ~30s). Skipped for admin/owner
  // gates so demotions and role changes take effect immediately.
  const requireFreshMembership = options.minRole === 'admin' || options.minRole === 'owner'

  let role: Role | null = null
  if (!requireFreshMembership) {
    const tokenMemberships = session.user.memberships
    if (tokenMemberships && tokenMemberships.length > 0) {
      const found = tokenMemberships.find((m: SessionMembership) => m.o === orgId)
      if (found) role = found.r
    }
  }

  // DB lookup: required for elevated roles, or when JWT lacked the membership.
  if (role === null) {
    const membership = await OrgMembership.findOne({
      userId: session.user.id,
      organizationId: orgId,
    }).lean<{ role: Role }>()
    if (!membership) {
      return forbidden('You are not a member of this organization')
    }
    role = membership.role
  }

  if (options.minRole && ROLE_RANK[role] < ROLE_RANK[options.minRole]) {
    return forbidden(`Requires ${options.minRole} role`)
  }

  return {
    session,
    userId: session.user.id,
    organizationId: orgId,
    role,
  }
}

/**
 * Create a fresh personal organization for a brand-new user and assign them
 * as owner. Called from the signup flow.
 */
export async function createPersonalOrganization(userId: string, userName: string) {
  await connectDB()

  const baseSlug =
    userName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30) || 'org'

  let slug = baseSlug
  let suffix = 0
  while (await Organization.exists({ slug })) {
    suffix++
    slug = `${baseSlug}-${suffix}`
  }

  const org = await Organization.create({
    name: 'Personal workspace',
    slug,
    ownerId: userId,
  })

  await OrgMembership.create({
    userId,
    organizationId: org._id,
    role: 'owner',
  })

  await User.findByIdAndUpdate(userId, { lastActiveOrganizationId: org._id })

  // New orgs start with no payment plans / event types. The owner configures
  // them via Settings — there are no application-wide defaults, by design.

  return org
}
