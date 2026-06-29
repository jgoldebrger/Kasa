import { handler } from '@/lib/api/handler'
import { hasMinRole } from '@/lib/auth-helpers'
import { listAssignedFamiliesForUser } from '@/lib/member-family-access.server'

/** GET /api/member/assigned-families — email-linked families for the current user. */
export const GET = handler({
  auth: 'org',
  name: 'GET /api/member/assigned-families',
  fn: async ({ ctx }) => {
    if (hasMinRole(ctx!.role, 'admin')) {
      return {
        data: { families: [], isAdmin: true },
        headers: { 'Cache-Control': 'private, max-age=30' },
      }
    }

    const { families } = await listAssignedFamiliesForUser(ctx!.organizationId, ctx!.userId)
    return {
      data: { families, isAdmin: false },
      headers: { 'Cache-Control': 'private, max-age=30' },
    }
  },
})
