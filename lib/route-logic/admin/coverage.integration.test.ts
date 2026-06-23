/**
 * lib/route-logic/admin — line and branch coverage for platform-admin routes.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { Types } from 'mongoose'
import { NextRequest } from 'next/server'
import {
  seedApiRouteFixtures,
  teardownApiRouteFixtures,
  type ApiTestContext,
} from '@/lib/test/api-route-fixtures'

const mockAuth = vi.hoisted(() => vi.fn())
const mockCookieGet = vi.hoisted(() => vi.fn())

vi.mock('@/app/auth', () => ({ auth: mockAuth }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: mockCookieGet })),
}))

const API_ORIGIN = 'http://localhost:3000'
let ctx: ApiTestContext

function bindSession(c: ApiTestContext) {
  mockAuth.mockResolvedValue({
    user: {
      id: c.userId,
      email: c.email,
      name: c.userName,
      memberships: [{ o: c.orgId, r: 'owner' }],
    },
  } as never)
  mockCookieGet.mockImplementation((name: string) =>
    name === 'kasa_active_org' ? { value: c.orgId } : undefined,
  )
}

function orgJsonReq(
  path: string,
  method: string,
  body?: unknown,
  opts?: { query?: string },
): NextRequest {
  const headers: Record<string, string> = {
    host: 'localhost:3000',
    origin: API_ORIGIN,
    'x-organization-id': ctx.orgId,
  }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const q = opts?.query ?? ''
  return new NextRequest(`${API_ORIGIN}${path}${q}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

async function withRateLimitBlocked<T>(fn: () => Promise<T>): Promise<T> {
  const rateLimit = await import('@/lib/rate-limit')
  const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValue({
    allowed: false,
    remaining: 0,
    resetAt: 0,
  })
  try {
    return await fn()
  } finally {
    spy.mockRestore()
  }
}

describe.sequential('route-logic admin domain coverage', () => {
  beforeAll(async () => {
    process.env.CRON_SECRET = process.env.CRON_SECRET || 'test-cron-secret'
    process.env.PLATFORM_ADMIN_EMAILS = ''
    ctx = await seedApiRouteFixtures()
    process.env.PLATFORM_ADMIN_EMAILS = ctx.email
    process.env.NEXTAUTH_URL = 'http://localhost:3000'
    bindSession(ctx)
  })

  afterAll(async () => {
    await teardownApiRouteFixtures()
    vi.restoreAllMocks()
  })

  describe('admin/invite-requests', () => {
    it('GET allows platform admin without 2FA', async () => {
      const { User } = await import('@/lib/models')
      await User.findByIdAndUpdate(ctx.userId, { $set: { twoFactorEnabled: false } })

      try {
        const { GET } = await import('@/lib/route-logic/admin/invite-requests')
        const res = await GET(orgJsonReq('/api/admin/invite-requests', 'GET'))
        expect(res.status).toBe(200)
      } finally {
        await User.findByIdAndUpdate(ctx.userId, { $set: { twoFactorEnabled: true } })
      }
    })

    it('GET maps approved rows, ignores invalid status filter, and handles null createdAt cursor', async () => {
      const { InviteRequest } = await import('@/lib/models')
      const approved = await InviteRequest.create({
        email: `admin-cov-approved-${Date.now()}@example.com`,
        name: 'Approved Row',
        message: 'please',
        status: 'approved',
        signupCode: 'cov-signup-code',
        signupCodeExpiresAt: new Date(Date.now() + 86_400_000),
        reviewedAt: new Date(),
        rejectReason: 'old reason',
        usedAt: new Date(),
      })

      const pag = await import('@/lib/pagination')
      const spy = vi
        .spyOn(pag, 'collectCompoundCursorPages')
        .mockImplementation(async (loadPage, baseFilter, _sf, _dir, getCursor, _bs) => {
          const page = await loadPage(baseFilter, 3)
          getCursor({ _id: new Types.ObjectId(), createdAt: null } as never)
          if (page[0]) getCursor(page[0] as never)
          return page
        })

      const platformEmail = await import('@/lib/platform-email')
      const configuredSpy = vi
        .spyOn(platformEmail, 'isPlatformEmailConfigured')
        .mockReturnValue(false)

      try {
        const { GET } = await import('@/lib/route-logic/admin/invite-requests')
        const invalidFilter = await GET(
          orgJsonReq('/api/admin/invite-requests', 'GET', undefined, { query: '?status=bogus' }),
        )
        expect(invalidFilter.status).toBe(200)

        const list = await GET(orgJsonReq('/api/admin/invite-requests', 'GET'))
        expect(list.status).toBe(200)
        const body = await list.json()
        expect(body.emailEnabled).toBe(false)
        const row = body.requests.find((r: { id: string }) => r.id === approved._id.toString())
        expect(row).toMatchObject({
          signupCode: 'cov-signup-code',
          signupUrl: 'http://localhost:3000/signup?code=cov-signup-code',
          rejectReason: 'old reason',
        })
        expect(row.usedAt).toBeTruthy()
        expect(row.reviewedAt).toBeTruthy()
      } finally {
        spy.mockRestore()
        configuredSpy.mockRestore()
        await InviteRequest.deleteOne({ _id: approved._id })
      }
    })

    it('PATCH validates input, returns 404, rejects with non-string reason, and rate-limits', async () => {
      const { InviteRequest } = await import('@/lib/models')
      const pending = await InviteRequest.create({
        email: `admin-cov-pending-${Date.now()}@example.com`,
        name: 'Pending Row',
        status: 'pending',
      })
      const missingId = new Types.ObjectId().toString()

      const platformEmail = await import('@/lib/platform-email')
      const configuredSpy = vi
        .spyOn(platformEmail, 'isPlatformEmailConfigured')
        .mockReturnValue(false)

      const { PATCH } = await import('@/lib/route-logic/admin/invite-requests')
      try {
        expect(
          (await PATCH(orgJsonReq('/api/admin/invite-requests', 'PATCH', { action: 'approve' })))
            .status,
        ).toBe(400)
        expect(
          (
            await PATCH(
              orgJsonReq('/api/admin/invite-requests', 'PATCH', {
                id: 'not-an-object-id',
                action: 'approve',
              }),
            )
          ).status,
        ).toBe(400)
        expect(
          (
            await PATCH(
              orgJsonReq('/api/admin/invite-requests', 'PATCH', {
                id: missingId,
                action: 'approve',
              }),
            )
          ).status,
        ).toBe(404)

        const reject = await PATCH(
          orgJsonReq('/api/admin/invite-requests', 'PATCH', {
            id: pending._id.toString(),
            action: 'reject',
            rejectReason: 42,
          }),
        )
        expect(reject.status).toBe(200)
        const rejectBody = await reject.json()
        expect(rejectBody.status).toBe('rejected')

        const approve = await PATCH(
          orgJsonReq('/api/admin/invite-requests', 'PATCH', {
            id: pending._id.toString(),
            action: 'approve',
          }),
        )
        expect(approve.status).toBe(200)
        const approveBody = await approve.json()
        expect(approveBody.email).toEqual({ sent: false, reason: 'platform SMTP not configured' })

        await withRateLimitBlocked(async () => {
          expect(
            (
              await PATCH(
                orgJsonReq('/api/admin/invite-requests', 'PATCH', {
                  id: missingId,
                  action: 'approve',
                }),
              )
            ).status,
          ).toBe(429)
        })
      } finally {
        configuredSpy.mockRestore()
        await InviteRequest.deleteOne({ _id: pending._id })
      }
    })
  })
})
