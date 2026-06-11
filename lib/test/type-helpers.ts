import type { OrgContext, AuthedSession, Role } from '@/lib/auth-helpers'

/** Loose lean query result for integration tests. */
export type LeanDoc = Record<string, unknown> & { _id: unknown }

export function mockSendOk(): { ok: true; email: null } {
  return { ok: true, email: null }
}

export function rateLimitDenied(remaining: number): import('@/lib/rate-limit').RateLimitVerdict {
  return { allowed: false, remaining, resetAt: 0 }
}

export function setNodeEnv(value: string): void {
  Object.defineProperty(process.env, 'NODE_ENV', {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  })
}

export function mockOrgContext(input: {
  organizationId: string
  userId: string
  role: Role
  email?: string
}): OrgContext {
  const session: AuthedSession = {
    user: {
      id: input.userId,
      email: input.email ?? 'test@example.com',
      name: 'Test User',
    },
  }
  return {
    session,
    userId: input.userId,
    organizationId: input.organizationId,
    role: input.role,
  }
}
