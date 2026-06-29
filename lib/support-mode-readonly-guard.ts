import { NextRequest, NextResponse } from 'next/server'
import type { OrgContext } from '@/lib/auth-helpers'

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Paths that are safe POST previews while in read-only support mode. */
function isReadOnlySafeMutation(pathname: string): boolean {
  return pathname.includes('/preview')
}

/**
 * Block org mutations when a platform admin is in read-only support impersonation.
 * Returns a 403 response, or null when the request may proceed.
 */
export function blockReadOnlySupportMutation(
  request: NextRequest,
  ctx: OrgContext | undefined,
): NextResponse | null {
  if (!ctx?.isPlatformImpersonationReadOnly) return null
  if (!MUTATION_METHODS.has(request.method.toUpperCase())) return null

  const pathname = new URL(request.url).pathname
  if (isReadOnlySafeMutation(pathname)) return null

  return NextResponse.json(
    {
      error:
        'Support mode is read-only. Exit support mode or use full admin access to make changes.',
    },
    { status: 403 },
  )
}
