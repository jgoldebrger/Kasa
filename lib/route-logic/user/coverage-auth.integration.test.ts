/**
 * User auth route-logic coverage — password, 2FA, profile (session).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  seedApiRouteFixtures,
  teardownApiRouteFixtures,
  type ApiTestContext,
} from '@/lib/test/api-route-fixtures'
import { generateTotpCode } from '@/lib/totp'

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

function sessionJsonReq(path: string, method: string, body?: unknown): NextRequest {
  const headers: Record<string, string> = {
    host: 'localhost:3000',
    origin: API_ORIGIN,
  }
  if (body !== undefined) headers['content-type'] = 'application/json'
  return new NextRequest(`${API_ORIGIN}${path}`, {
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

describe.sequential('user auth route-logic coverage', () => {
  beforeAll(async () => {
    ctx = await seedApiRouteFixtures()
    bindSession(ctx)
  })

  afterAll(async () => {
    await teardownApiRouteFixtures()
    vi.restoreAllMocks()
  })

  describe('GET/PATCH /api/user', () => {
    it('returns profile with empty fallbacks and rejects empty PATCH', async () => {
      const { User } = await import('@/lib/models')
      await User.updateOne({ _id: ctx.userId }, { $unset: { name: 1, image: 1 } })
      bindSession(ctx)

      const { GET, PATCH } = await import('@/lib/route-logic/user')
      const profile = await GET(sessionJsonReq('/api/user', 'GET'))
      expect(profile.status).toBe(200)
      const body = await profile.json()
      expect(body.name).toBe('')
      expect(body.email).toBe(ctx.email)
      expect(body.image).toBeNull()

      const emptyPatch = await PATCH(sessionJsonReq('/api/user', 'PATCH', {}))
      expect(emptyPatch.status).toBe(400)

      await User.updateOne({ _id: ctx.userId }, { $set: { name: ctx.userName } })
      bindSession(ctx)
    })

    it('returns 404 when user record missing', async () => {
      const ghostId = '507f1f77bcf86cd799439099'
      mockAuth.mockResolvedValueOnce({
        user: { id: ghostId, email: 'ghost@example.com', memberships: [{ o: ctx.orgId, r: 'owner' }] },
      } as never)

      const { GET } = await import('@/lib/route-logic/user')
      expect((await GET(sessionJsonReq('/api/user', 'GET'))).status).toBe(404)
      bindSession(ctx)
    })

    it('returns 429 when rate limited', async () => {
      const { GET } = await import('@/lib/route-logic/user')
      await withRateLimitBlocked(async () => {
        expect((await GET(sessionJsonReq('/api/user', 'GET'))).status).toBe(429)
      })
    })
  })

  describe('PATCH /api/user/password', () => {
    it('rejects matching passwords and changes password on success', async () => {
      const current = 'ApiRouteTestPass123!'
      const { PATCH } = await import('@/lib/route-logic/user/password')

      const same = await PATCH(
        sessionJsonReq('/api/user/password', 'PATCH', {
          currentPassword: current,
          newPassword: current,
        }),
      )
      expect(same.status).toBe(400)

      const wrong = await PATCH(
        sessionJsonReq('/api/user/password', 'PATCH', {
          currentPassword: 'wrong-password',
          newPassword: 'NewPass123!zz',
        }),
      )
      expect(wrong.status).toBe(401)

      const ok = await PATCH(
        sessionJsonReq('/api/user/password', 'PATCH', {
          currentPassword: current,
          newPassword: 'NewPass123!zz',
        }),
      )
      expect(ok.status).toBe(200)

      const bcrypt = await import('bcryptjs')
      await (
        await import('@/lib/models')
      ).User.updateOne(
        { _id: ctx.userId },
        { $set: { hashedPassword: await bcrypt.hash(current, 10) } },
      )
      bindSession(ctx)
    })
  })

  describe('user/2fa enable flow', () => {
    it('enrolls 2FA via setup then PATCH enable', async () => {
      const bcrypt = await import('bcryptjs')
      const { User } = await import('@/lib/models')
      const password = 'ApiRouteTestPass123!'
      await User.updateOne(
        { _id: ctx.userId },
        {
          $set: { hashedPassword: await bcrypt.hash(password, 10), twoFactorEnabled: false },
          $unset: { twoFactorSecret: 1, twoFactorBackupCodes: 1, twoFactorLastUsedStep: 1 },
        },
      )
      bindSession(ctx)

      const { POST } = await import('@/lib/route-logic/user/2fa/setup')
      const setup = await POST(sessionJsonReq('/api/user/2fa/setup', 'POST', { password }))
      expect(setup.status).toBe(200)
      const setupBody = await setup.json()
      expect(setupBody.otpauthUrl).toContain('otpauth://')
      expect(setupBody.backupCodes?.length).toBeGreaterThan(0)

      const secretMatch = setupBody.otpauthUrl.match(/secret=([A-Z2-7]+)/i)
      expect(secretMatch).toBeTruthy()
      const code = generateTotpCode(secretMatch![1])

      const { PATCH } = await import('@/lib/route-logic/user/2fa')
      const enable = await PATCH(
        sessionJsonReq('/api/user/2fa', 'PATCH', { action: 'enable', code }),
      )
      expect(enable.status).toBe(200)

      await User.updateOne(
        { _id: ctx.userId },
        {
          $set: { twoFactorEnabled: false, hashedPassword: await bcrypt.hash(password, 10) },
          $unset: { twoFactorSecret: 1, twoFactorBackupCodes: 1, twoFactorLastUsedStep: 1 },
        },
      )
      bindSession(ctx)
    })
  })
})
