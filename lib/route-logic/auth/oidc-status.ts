import { handler } from '@/lib/api/handler'
import { getOidcPublicStatus } from '@/lib/oidc-config'

export const dynamic = 'force-dynamic'

/** GET /api/auth/oidc-status — public OIDC availability for the login page. */
export const GET = handler({
  auth: 'public',
  name: 'GET /api/auth/oidc-status',
  fn: async () => ({
    data: getOidcPublicStatus(),
    headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
  }),
})
