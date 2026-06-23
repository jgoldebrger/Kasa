import { mockOrgContext } from '@/lib/test/type-helpers'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

vi.mock('@/lib/database', () => ({
  default: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/csrf', () => ({
  verifyApiCsrf: vi.fn().mockReturnValue(null),
}))
vi.mock('@/lib/auth-helpers', () => ({
  requireSession: vi.fn(),
  requireOrg: vi.fn(),
}))
vi.mock('@/lib/auth-cron', () => ({
  isCronRequest: vi.fn(),
  requireOrgOrCron: vi.fn(),
}))
vi.mock('@/lib/platform-admin', () => ({
  isPlatformAdminEmail: vi.fn(),
  assertPlatformAdminTwoFactor: vi.fn(),
}))

function sameOriginRequest(
  url: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
) {
  return new NextRequest(url, {
    method: init.method ?? 'GET',
    headers: {
      host: 'localhost',
      origin: 'http://localhost',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
    body: init.body,
  })
}

describe('handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs public handlers without auth', async () => {
    const { handler } = await import('./handler')
    const route = handler({
      auth: 'public',
      noDb: true,
      fn: async () => ({ data: { ok: true } }),
    })

    const res = await route(sameOriginRequest('http://localhost/api/ping'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
  })

  it('returns 400 for invalid idParams', async () => {
    const { handler } = await import('./handler')
    const route = handler({
      auth: 'public',
      noDb: true,
      idParams: ['familyId'],
      fn: async () => ({ ok: true }),
    })

    const res = await route(sameOriginRequest('http://localhost/api/families/x'), {
      params: { familyId: 'not-an-object-id' },
    })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'Invalid familyId' })
  })

  it('returns 400 when body validation fails', async () => {
    const { handler } = await import('./handler')
    const route = handler({
      auth: 'public',
      noDb: true,
      body: z.object({ name: z.string().min(1) }),
      fn: async () => ({ ok: true }),
    })

    const res = await route(
      sameOriginRequest('http://localhost/api/families', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Validation failed')
    expect(body.issues).toBeDefined()
  })

  it('returns 400 when query validation fails', async () => {
    const { handler } = await import('./handler')
    const route = handler({
      auth: 'public',
      noDb: true,
      query: z.object({ year: z.coerce.number().int().min(2000) }),
      fn: async () => ({ ok: true }),
    })

    const res = await route(sameOriginRequest('http://localhost/api/reports?year=abc'))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'Validation failed' })
  })

  it('propagates requireOrg 401 responses', async () => {
    const { requireOrg } = await import('@/lib/auth-helpers')
    vi.mocked(requireOrg).mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    )

    const { handler } = await import('./handler')
    const route = handler({
      auth: 'org',
      noDb: true,
      fn: async () => ({ ok: true }),
    })

    const res = await route(sameOriginRequest('http://localhost/api/families'))
    expect(res.status).toBe(401)
  })

  it('passes org context into the handler function', async () => {
    const { requireOrg } = await import('@/lib/auth-helpers')
    const ctx = mockOrgContext({
      organizationId: '507f1f77bcf86cd799439011',
      userId: 'u1',
      role: 'admin',
      email: 'a@b.com',
    })
    vi.mocked(requireOrg).mockResolvedValue(ctx)

    const { handler } = await import('./handler')
    const route = handler({
      auth: 'org',
      noDb: true,
      fn: async ({ ctx: c }) => ({ data: { orgId: c!.organizationId } }),
    })

    const res = await route(sameOriginRequest('http://localhost/api/families'))
    await expect(res.json()).resolves.toEqual({ orgId: ctx.organizationId })
  })

  it('rejects cron requests on org-only routes', async () => {
    const { isCronRequest } = await import('@/lib/auth-cron')
    vi.mocked(isCronRequest).mockReturnValue(true)

    const { handler } = await import('./handler')
    const route = handler({
      auth: 'org',
      minRole: 'admin',
      noDb: true,
      fn: async () => ({ ok: true }),
    })

    const res = await route(sameOriginRequest('http://localhost/api/families'))
    expect(res.status).toBe(401)
  })

  it('rejects cron requests without a valid secret', async () => {
    const { isCronRequest } = await import('@/lib/auth-cron')
    vi.mocked(isCronRequest).mockReturnValue(false)

    const { handler } = await import('./handler')
    const route = handler({
      auth: 'cron',
      noDb: true,
      fn: async () => ({ ok: true }),
    })

    const res = await route(sameOriginRequest('http://localhost/api/jobs/tick'))
    expect(res.status).toBe(401)
  })

  it('allows trusted cron requests', async () => {
    const { isCronRequest } = await import('@/lib/auth-cron')
    vi.mocked(isCronRequest).mockReturnValue(true)

    const { handler } = await import('./handler')
    const route = handler({
      auth: 'cron',
      noDb: true,
      fn: async () => ({ data: { ran: true } }),
    })

    const res = await route(sameOriginRequest('http://localhost/api/jobs/tick'))
    await expect(res.json()).resolves.toEqual({ ran: true })
  })

  it('returns 403 for admin routes when email is not a platform admin', async () => {
    const { requireSession } = await import('@/lib/auth-helpers')
    const { isPlatformAdminEmail } = await import('@/lib/platform-admin')
    vi.mocked(requireSession).mockResolvedValue({
      user: { id: 'u1', email: 'user@example.com' },
    } as any)
    vi.mocked(isPlatformAdminEmail).mockReturnValue(false)

    const { handler } = await import('./handler')
    const route = handler({
      auth: 'admin',
      noDb: true,
      fn: async () => ({ ok: true }),
    })

    const res = await route(sameOriginRequest('http://localhost/api/platform'))
    expect(res.status).toBe(403)
  })

  it('unwraps { status, data } return shapes', async () => {
    const { handler } = await import('./handler')
    const route = handler({
      auth: 'public',
      noDb: true,
      fn: async () => ({ status: 201, data: { id: 'new' } }),
    })

    const res = await route(sameOriginRequest('http://localhost/api/items'))
    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toEqual({ id: 'new' })
  })

  it('returns 500 when the handler throws', async () => {
    const { handler } = await import('./handler')
    const route = handler({
      auth: 'public',
      noDb: true,
      fn: async () => {
        throw new Error('boom')
      },
    })

    const res = await route(sameOriginRequest('http://localhost/api/broken'))
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toMatchObject({ error: 'Internal server error' })
  })

  it('runs session handlers when requireSession succeeds', async () => {
    const { requireSession } = await import('@/lib/auth-helpers')
    vi.mocked(requireSession).mockResolvedValue({
      user: { id: 'u1', email: 'user@example.com' },
    } as any)

    const { handler } = await import('./handler')
    const route = handler({
      auth: 'session',
      noDb: true,
      fn: async ({ session }) => ({ data: { email: session!.user.email } }),
    })

    const res = await route(sameOriginRequest('http://localhost/api/me'))
    await expect(res.json()).resolves.toEqual({ email: 'user@example.com' })
  })

  it('allows platform admin routes for admin emails without requiring 2FA', async () => {
    const { requireSession } = await import('@/lib/auth-helpers')
    const { isPlatformAdminEmail, assertPlatformAdminTwoFactor } =
      await import('@/lib/platform-admin')
    vi.mocked(requireSession).mockResolvedValue({
      user: { id: 'u1', email: 'admin@example.com' },
    } as any)
    vi.mocked(isPlatformAdminEmail).mockReturnValue(true)

    const { handler } = await import('./handler')
    const route = handler({
      auth: 'admin',
      noDb: true,
      fn: async () => ({ data: { ok: true } }),
    })

    const res = await route(sameOriginRequest('http://localhost/api/platform'))
    expect(assertPlatformAdminTwoFactor).not.toHaveBeenCalled()
    await expect(res.json()).resolves.toEqual({ ok: true })
  })

  it('returns 403 for platform admin routes when platformAdminTwoFactor is true and 2FA is off', async () => {
    const { requireSession } = await import('@/lib/auth-helpers')
    const { isPlatformAdminEmail, assertPlatformAdminTwoFactor } =
      await import('@/lib/platform-admin')
    vi.mocked(requireSession).mockResolvedValue({
      user: { id: 'u1', email: 'admin@example.com' },
    } as any)
    vi.mocked(isPlatformAdminEmail).mockReturnValue(true)
    vi.mocked(assertPlatformAdminTwoFactor).mockResolvedValue(
      NextResponse.json(
        {
          error: 'Two-factor authentication is required',
          code: 'PLATFORM_ADMIN_2FA_REQUIRED',
        },
        { status: 403 },
      ),
    )

    const { handler } = await import('./handler')
    const route = handler({
      auth: 'admin',
      platformAdminTwoFactor: true,
      noDb: true,
      fn: async () => ({ data: { ok: true } }),
    })

    const res = await route(sameOriginRequest('http://localhost/api/platform'))
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({
      code: 'PLATFORM_ADMIN_2FA_REQUIRED',
    })
  })

  it('does not require 2FA on admin routes by default', async () => {
    const { requireSession } = await import('@/lib/auth-helpers')
    const { isPlatformAdminEmail, assertPlatformAdminTwoFactor } =
      await import('@/lib/platform-admin')
    vi.mocked(requireSession).mockResolvedValue({
      user: { id: 'u1', email: 'admin@example.com' },
    } as any)
    vi.mocked(isPlatformAdminEmail).mockReturnValue(true)
    vi.mocked(assertPlatformAdminTwoFactor).mockResolvedValue(
      NextResponse.json({ error: '2FA required' }, { status: 403 }),
    )

    const { handler } = await import('./handler')
    const route = handler({
      auth: 'admin',
      noDb: true,
      fn: async () => ({ data: { ok: true } }),
    })

    const res = await route(sameOriginRequest('http://localhost/api/admin/organizations'))
    expect(assertPlatformAdminTwoFactor).not.toHaveBeenCalled()
    await expect(res.json()).resolves.toEqual({ ok: true })
  })

  it('passes org-or-cron context when cron+org auth succeeds', async () => {
    const { requireOrgOrCron } = await import('@/lib/auth-cron')
    const ctx = mockOrgContext({
      organizationId: '507f1f77bcf86cd799439011',
      userId: 'u1',
      role: 'admin',
      email: 'a@b.com',
    })
    vi.mocked(requireOrgOrCron).mockResolvedValue(ctx)

    const { handler } = await import('./handler')
    const route = handler({
      auth: 'org-or-cron',
      noDb: true,
      fn: async ({ ctx: c }) => ({ data: { orgId: c!.organizationId } }),
    })

    const res = await route(sameOriginRequest('http://localhost/api/jobs'))
    await expect(res.json()).resolves.toEqual({ orgId: ctx.organizationId })
  })

  it('accepts valid idParams including array route params', async () => {
    const { handler } = await import('./handler')
    const validId = '507f1f77bcf86cd799439011'
    const route = handler({
      auth: 'public',
      noDb: true,
      idParams: ['familyId'],
      fn: async ({ params }) => ({ data: { familyId: params.familyId } }),
    })

    const res = await route(sameOriginRequest('http://localhost/api/families/x'), {
      params: { familyId: [validId, 'ignored'] },
    })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ familyId: [validId, 'ignored'] })
  })

  it('parses valid JSON bodies on mutating methods', async () => {
    const { handler } = await import('./handler')
    const route = handler({
      auth: 'public',
      noDb: true,
      body: z.object({ name: z.string().min(1) }),
      fn: async ({ body }) => ({ data: { name: body.name } }),
    })

    const res = await route(
      sameOriginRequest('http://localhost/api/families', {
        method: 'POST',
        body: JSON.stringify({ name: 'Cohen' }),
      }),
    )
    await expect(res.json()).resolves.toEqual({ name: 'Cohen' })
  })

  it('parses valid query strings', async () => {
    const { handler } = await import('./handler')
    const route = handler({
      auth: 'public',
      noDb: true,
      query: z.object({ year: z.coerce.number().int().min(2000) }),
      fn: async ({ query }) => ({ data: { year: query.year } }),
    })

    const res = await route(sameOriginRequest('http://localhost/api/reports?year=2024'))
    await expect(res.json()).resolves.toEqual({ year: 2024 })
  })

  it('returns plain objects as JSON with 200', async () => {
    const { handler } = await import('./handler')
    const route = handler({
      auth: 'public',
      noDb: true,
      fn: async () => ({ items: [1, 2] }),
    })

    const res = await route(sameOriginRequest('http://localhost/api/items'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ items: [1, 2] })
  })

  it('returns ok for void handler results', async () => {
    const { handler } = await import('./handler')
    const route = handler({
      auth: 'public',
      noDb: true,
      fn: async () => undefined,
    })

    const res = await route(sameOriginRequest('http://localhost/api/noop'))
    await expect(res.json()).resolves.toEqual({ ok: true })
  })

  it('passes through NextResponse returns from the handler', async () => {
    const { handler } = await import('./handler')
    const route = handler({
      auth: 'public',
      noDb: true,
      fn: async () => NextResponse.json({ custom: true }, { status: 418 }),
    })

    const res = await route(sameOriginRequest('http://localhost/api/teapot'))
    expect(res.status).toBe(418)
    await expect(res.json()).resolves.toEqual({ custom: true })
  })

  it('applies custom response headers from wrapper returns', async () => {
    const { handler } = await import('./handler')
    const route = handler({
      auth: 'public',
      noDb: true,
      fn: async () => ({
        status: 200,
        data: { ok: true },
        headers: { 'x-custom': '1' },
      }),
    })

    const res = await route(sameOriginRequest('http://localhost/api/headers'))
    expect(res.headers.get('x-custom')).toBe('1')
  })

  it('short-circuits when CSRF verification fails', async () => {
    const { verifyApiCsrf } = await import('@/lib/csrf')
    vi.mocked(verifyApiCsrf).mockReturnValue(
      NextResponse.json({ error: 'Cross-site request blocked' }, { status: 403 }),
    )

    const { handler } = await import('./handler')
    const route = handler({
      auth: 'public',
      noDb: true,
      fn: async () => ({ should: 'not run' }),
    })

    const res = await route(
      sameOriginRequest('http://localhost/api/families', { method: 'POST', body: '{}' }),
    )
    expect(res.status).toBe(403)
  })
})
