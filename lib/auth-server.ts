import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { Types } from 'mongoose'
import { auth } from '@/app/auth'
import connectDB from '@/lib/database'
import { OrgMembership, User } from '@/lib/models'
import { ACTIVE_ORG_COOKIE, type Role, hasMinRole } from '@/lib/auth-helpers'
import {
  enforcePlatformAccountAccess,
  platformAccessRedirectPath,
} from '@/lib/billing/account-access'
import { isPlatformImpersonating, readImpersonationReadOnly } from '@/lib/platform-impersonation'

/**
 * Per-request memoized `auth()`. Use this from layout.tsx + every server
 * `page.tsx` so multiple consumers in the same render share one call. NextAuth
 * dedupes internally but React's `cache()` guarantees a single resolution
 * even across nested server components and Suspense boundaries.
 */
export const getCachedAuth = cache(async () => {
  return auth()
})

export interface ServerOrgContext {
  userId: string
  email: string
  name: string
  organizationId: string
  role: Role
  isPlatformImpersonation?: boolean
  isPlatformImpersonationReadOnly?: boolean
}

/**
 * Server-component / server-action variant of `requireOrg`. Reads the
 * session via `auth()` (so it's cached by NextAuth) and resolves the
 * active organization from the cookie / user record. Memoized per request
 * with React's `cache()` so multiple components on the same page share
 * one resolution.
 */
export const getServerOrgContext = cache(async (): Promise<ServerOrgContext | null> => {
  const session = await getCachedAuth()
  const userId = session?.user?.id
  if (!userId) return null

  // Try the cookie first — set by OrgSwitcher on the client.
  let orgId: string | null = null
  try {
    orgId = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value || null
  } catch {
    // cookies() throws if called outside a request scope — fall through.
  }

  // Fall back to the user's lastActiveOrganizationId / first membership.
  if (!orgId) {
    await connectDB()
    const user = await User.findById(userId)
      .select('lastActiveOrganizationId')
      .lean<{ lastActiveOrganizationId?: Types.ObjectId }>()
    if (user?.lastActiveOrganizationId) {
      orgId = user.lastActiveOrganizationId.toString()
    } else {
      const m = await OrgMembership.findOne({ userId })
        .select('organizationId')
        .lean<{ organizationId: Types.ObjectId }>()
      if (m) orgId = m.organizationId.toString()
    }
  }

  if (!orgId || !Types.ObjectId.isValid(orgId)) return null

  // Resolve role — prefer the JWT memberships list, fall back to a DB read.
  const memberships = session.user?.memberships
  let role: Role | null = null
  if (memberships && memberships.length > 0) {
    const m = memberships.find((m) => m.o === orgId)
    if (m) role = m.r
  }
  if (role === null) {
    await connectDB()
    const m = await OrgMembership.findOne({ userId, organizationId: orgId })
      .select('role')
      .lean<{ role: Role }>()
    if (!m) {
      if (await isPlatformImpersonating(userId, session.user?.email, orgId)) {
        const readOnly = await readImpersonationReadOnly(userId)
        return {
          userId,
          email: session.user?.email || '',
          name: session.user?.name || '',
          organizationId: orgId,
          role: readOnly ? 'member' : 'admin',
          isPlatformImpersonation: true,
          isPlatformImpersonationReadOnly: readOnly || undefined,
        }
      }
      return null
    }
    role = m.role
  }

  const impersonating = await isPlatformImpersonating(userId, session.user?.email, orgId)
  const readOnly = impersonating ? await readImpersonationReadOnly(userId) : false

  return {
    userId,
    email: session.user?.email || '',
    name: session.user?.name || '',
    organizationId: orgId,
    role,
    isPlatformImpersonation: impersonating || undefined,
    isPlatformImpersonationReadOnly: readOnly || undefined,
  }
})

/**
 * Like `getServerOrgContext` but redirects to /login when there's no
 * authenticated user. Use at the top of protected server-component pages.
 *
 * Pass `{ minRole: 'admin' }` (etc.) to redirect non-privileged users to
 * the dashboard — mirrors `requireOrg(request, { minRole })` on API routes.
 */
export async function requireServerOrgContext(options?: {
  minRole?: Role
  /** Allow pages like /setup and /settings (billing) without a subscription. */
  skipSubscriptionGate?: boolean
}): Promise<ServerOrgContext> {
  const ctx = await getServerOrgContext()
  if (!ctx) redirect('/login')
  if (options?.minRole && !hasMinRole(ctx.role, options.minRole)) {
    redirect('/')
  }
  if (!options?.skipSubscriptionGate && !ctx.isPlatformImpersonation) {
    const gate = await enforcePlatformAccountAccess(ctx.organizationId)
    if (!gate.ok) {
      redirect(platformAccessRedirectPath(ctx.role))
    }
  }
  return ctx
}
