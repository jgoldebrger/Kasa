/**
 * Auth route-logic coverage — tests live under lib/route-logic/auth/ per domain scope.
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

function bindSession(c: ApiTestContext, role: 'owner' | 'admin' | 'member' = 'owner', orgId?: string) {
  mockAuth.mockResolvedValue({
    user: {
      id: c.userId,
      email: c.email,
      name: c.userName,
      memberships: [{ o: orgId ?? c.orgId, r: role }],
    },
  } as never)
  mockCookieGet.mockImplementation((name: string) =>
    name === 'kasa_active_org' ? { value: orgId ?? c.orgId } : undefined,
  )
}

function orgJsonReq(
  path: string,
  method: string,
  body?: unknown,
  opts?: { query?: string; orgId?: string },
): NextRequest {
  const headers: Record<string, string> = {
    host: 'localhost:3000',
    origin: API_ORIGIN,
    'x-organization-id': opts?.orgId ?? ctx.orgId,
  }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const q = opts?.query ?? ''
  return new NextRequest(`${API_ORIGIN}${path}${q}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

function publicJsonReq(path: string, method: string, body?: unknown, query = ''): NextRequest {
  const headers: Record<string, string> = {
    host: 'localhost:3000',
    origin: API_ORIGIN,
  }
  if (body !== undefined) headers['content-type'] = 'application/json'
  return new NextRequest(`${API_ORIGIN}${path}${query}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

async function withRateLimitKeyBlocked<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const rateLimit = await import('@/lib/rate-limit')
  const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockImplementation(async (_req, k) => {
    if (k === key) return { allowed: false, remaining: 0, resetAt: 0 }
    return { allowed: true, remaining: 99, resetAt: 0 }
  })
  try {
    return await fn()
  } finally {
    spy.mockRestore()
  }
}

describe.sequential('auth route-logic coverage', () => {
  beforeAll(async () => {
    ctx = await seedApiRouteFixtures()
    bindSession(ctx)
  })

  afterAll(async () => {
    await teardownApiRouteFixtures()
    vi.restoreAllMocks()
  })

  describe('auth/signup', () => {
    it('GET validates approved, expired, and missing codes', async () => {
      const { InviteRequest } = await import('@/lib/models')
      const validCode = `cov-valid-${Date.now()}`
      const expiredCode = `cov-exp-${Date.now()}`
      await InviteRequest.create({
        email: `cov-valid-${Date.now()}@example.com`,
        name: 'Valid User',
        status: 'approved',
        signupCode: validCode,
      })
      await InviteRequest.create({
        email: `cov-exp-${Date.now()}@example.com`,
        name: 'Expired User',
        status: 'approved',
        signupCode: expiredCode,
        signupCodeExpiresAt: new Date(Date.now() - 60_000),
      })

      const { GET } = await import('@/lib/route-logic/auth/signup')
      const valid = await GET(
        new NextRequest(`${API_ORIGIN}/api/auth/signup?code=${encodeURIComponent(validCode)}`, {
          method: 'GET',
          headers: { host: 'localhost:3000', origin: API_ORIGIN },
        }),
      )
      expect(valid.status).toBe(200)
      const validBody = await valid.json()
      expect(validBody.valid).toBe(true)
      expect(validBody.email).toBeTruthy()

      const expired = await GET(
        new NextRequest(`${API_ORIGIN}/api/auth/signup?code=${encodeURIComponent(expiredCode)}`, {
          method: 'GET',
          headers: { host: 'localhost:3000', origin: API_ORIGIN },
        }),
      )
      expect((await expired.json()).valid).toBe(false)

      const missing = await GET(
        new NextRequest(`${API_ORIGIN}/api/auth/signup?code=nonexistent-code`, {
          method: 'GET',
          headers: { host: 'localhost:3000', origin: API_ORIGIN },
        }),
      )
      expect((await missing.json()).valid).toBe(false)

      await InviteRequest.deleteMany({ signupCode: { $in: [validCode, expiredCode] } })
    })

    it('POST returns 429 when signup rate limited', async () => {
      const rateLimit = await import('@/lib/rate-limit')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      const { POST } = await import('@/lib/route-logic/auth/signup')
      const res = await POST(
        publicJsonReq('/api/auth/signup', 'POST', {
          name: 'Rate Limited',
          password: 'SignupPass123!',
          inviteCode: 'any-code',
        }),
      )
      expect(res.status).toBe(429)
      spy.mockRestore()
    })
  })

  describe('auth/request-invite', () => {
    it('rejects invalid body and skips name update for approved requests', async () => {
      const { InviteRequest } = await import('@/lib/models')
      const email = `approved-req-${Date.now()}@example.com`
      await InviteRequest.create({
        email,
        name: 'Original Name',
        status: 'approved',
        signupCode: `code-${Date.now()}`,
      })

      const { POST } = await import('@/lib/route-logic/auth/request-invite')
      const badBody = await POST(
        new NextRequest(`${API_ORIGIN}/api/auth/request-invite`, {
          method: 'POST',
          headers: { host: 'localhost:3000', origin: API_ORIGIN, 'content-type': 'application/json' },
          body: 'not-json',
        }),
      )
      expect(badBody.status).toBe(400)

      const res = await POST(
        publicJsonReq('/api/auth/request-invite', 'POST', {
          email,
          name: 'Updated Name',
          message: 'hello',
        }),
      )
      expect(res.status).toBe(200)
      const doc = await InviteRequest.findOne({ email }).lean<{ name?: string }>()
      expect(doc?.name).toBe('Original Name')

      await InviteRequest.deleteMany({ email })
    })

    it('updates pending request name in place', async () => {
      const { InviteRequest } = await import('@/lib/models')
      const email = `pending-update-${Date.now()}@example.com`
      await InviteRequest.create({ email, name: 'Old Name', status: 'pending' })

      const { POST } = await import('@/lib/route-logic/auth/request-invite')
      await POST(publicJsonReq('/api/auth/request-invite', 'POST', { email, name: 'New Name' }))
      const doc = await InviteRequest.findOne({ email }).lean<{ name?: string }>()
      expect(doc?.name).toBe('New Name')

      await InviteRequest.deleteMany({ email })
    })

    it('notifies platform admins only when a new request is created', async () => {
      const platformEmail = await import('@/lib/platform-email')
      const notifySpy = vi
        .spyOn(platformEmail, 'notifyPlatformAdminsOfInviteRequest')
        .mockResolvedValue(undefined)

      const email = `notify-new-${Date.now()}@example.com`
      const { POST } = await import('@/lib/route-logic/auth/request-invite')
      const created = await POST(
        publicJsonReq('/api/auth/request-invite', 'POST', {
          email,
          name: 'Notify User',
          orgName: 'Test Community',
        }),
      )
      expect(created.status).toBe(200)
      expect(notifySpy).toHaveBeenCalledOnce()
      expect(notifySpy).toHaveBeenCalledWith({
        name: 'Notify User',
        email,
        orgName: 'Test Community',
      })

      notifySpy.mockClear()
      const updated = await POST(
        publicJsonReq('/api/auth/request-invite', 'POST', {
          email,
          name: 'Notify User Updated',
        }),
      )
      expect(updated.status).toBe(200)
      expect(notifySpy).not.toHaveBeenCalled()

      notifySpy.mockRestore()
      await (await import('@/lib/models')).InviteRequest.deleteMany({ email })
    })

    it('still succeeds when platform SMTP is not configured', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const smtpKeys = [
        'PLATFORM_SMTP_HOST',
        'PLATFORM_SMTP_PORT',
        'PLATFORM_SMTP_USER',
        'PLATFORM_SMTP_PASS',
        'PLATFORM_SMTP_FROM',
      ] as const
      const prevSmtp = Object.fromEntries(smtpKeys.map((k) => [k, process.env[k]]))
      const prevAdmins = process.env.PLATFORM_ADMIN_EMAILS
      for (const key of smtpKeys) delete process.env[key]
      process.env.PLATFORM_ADMIN_EMAILS = 'admin@example.com'

      const email = `notify-skip-${Date.now()}@example.com`
      const rateLimit = await import('@/lib/rate-limit')
      const rateSpy = vi
        .spyOn(rateLimit, 'checkRateLimit')
        .mockResolvedValue({ allowed: true, remaining: 99, resetAt: 0 })
      const { POST } = await import('@/lib/route-logic/auth/request-invite')
      const res = await POST(
        publicJsonReq('/api/auth/request-invite', 'POST', {
          email,
          name: 'Skip Notify',
        }),
      )
      expect(res.status).toBe(200)
      expect((await res.json()).ok).toBe(true)
      expect(warnSpy).toHaveBeenCalledWith(
        '[request-invite] Platform SMTP not configured; admin notification not sent.',
      )
      rateSpy.mockRestore()

      for (const key of smtpKeys) {
        if (prevSmtp[key] === undefined) delete process.env[key]
        else process.env[key] = prevSmtp[key]
      }
      if (prevAdmins === undefined) delete process.env.PLATFORM_ADMIN_EMAILS
      else process.env.PLATFORM_ADMIN_EMAILS = prevAdmins
      warnSpy.mockRestore()
      await (await import('@/lib/models')).InviteRequest.deleteMany({ email })
    })
  })

  describe('auth/reset-password', () => {
    it('no-ops when per-email rate limit hit and accepts legacy cleartext tokens', async () => {
      const token = `legacy-${Date.now()}`
      const { PasswordResetToken } = await import('@/lib/models')

      await withRateLimitKeyBlocked('pwd-reset-email', async () => {
        const { POST } = await import('@/lib/route-logic/auth/reset-password')
        const res = await POST(
          publicJsonReq('/api/auth/reset-password', 'POST', { email: ctx.email }),
        )
        expect(res.status).toBe(200)
        expect((await res.json()).ok).toBe(true)
      })

      await PasswordResetToken.create({
        userId: ctx.userId,
        token,
        expiresAt: new Date(Date.now() + 3600_000),
      })

      const { GET, PUT } = await import('@/lib/route-logic/auth/reset-password')
      const preflight = await GET(
        new NextRequest(`${API_ORIGIN}/api/auth/reset-password?token=${encodeURIComponent(token)}`, {
          method: 'GET',
          headers: { host: 'localhost:3000', origin: API_ORIGIN },
        }),
      )
      expect((await preflight.json()).valid).toBe(true)

      const reset = await PUT(
        publicJsonReq('/api/auth/reset-password', 'PUT', {
          token,
          newPassword: 'LegacyResetPass123!',
        }),
      )
      expect(reset.status).toBe(200)

      await PasswordResetToken.deleteMany({ userId: ctx.userId })
      const bcrypt = await import('bcryptjs')
      await (
        await import('@/lib/models')
      ).User.updateOne(
        { _id: ctx.userId },
        { $set: { hashedPassword: await bcrypt.hash('ApiRouteTestPass123!', 10) } },
      )
    })
  })

  describe('auth/invite', () => {
    it('PUT uses fallback password error when schema issue has no message', async () => {
      const { Invite } = await import('@/lib/models')
      const token = `fb-pw-${Date.now()}`
      await Invite.create({
        organizationId: ctx.orgId,
        email: `fb-pw-${Date.now()}@example.com`,
        role: 'member',
        token,
        invitedById: ctx.userId,
        expiresAt: new Date(Date.now() + 86400_000),
      })
      mockAuth.mockResolvedValueOnce(null as never)
      const common = await import('@/lib/schemas/common')
      const spy = vi.spyOn(common.password, 'safeParse').mockReturnValueOnce({
        success: false,
        error: { issues: [{}] },
      } as never)

      const { PUT } = await import('@/lib/route-logic/auth/invite')
      const res = await PUT(
        publicJsonReq('/api/auth/invite', 'PUT', {
          token,
          name: 'Valid Name',
          password: 'ValidPass1!',
        }),
      )
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('Invalid password')
      spy.mockRestore()
      bindSession(ctx)
      await Invite.deleteMany({ token })
    })

    it('PUT accepts invite for signed-in user with matching email', async () => {
      const { Invite, User } = await import('@/lib/models')
      const token = `session-${Date.now()}`
      const email = `session-inv-${Date.now()}@example.com`
      const bcrypt = await import('bcryptjs')
      const user = await User.create({
        email,
        name: 'Session Invitee',
        hashedPassword: await bcrypt.hash('SessionPass123!', 10),
      })
      await Invite.create({
        organizationId: ctx.orgId,
        email,
        role: 'member',
        token,
        invitedById: ctx.userId,
        expiresAt: new Date(Date.now() + 86400_000),
      })

      mockAuth.mockResolvedValueOnce({
        user: { id: user._id.toString(), email, memberships: [] },
      } as never)

      const { PUT } = await import('@/lib/route-logic/auth/invite')
      const res = await PUT(publicJsonReq('/api/auth/invite', 'PUT', { token }))
      expect(res.status).toBe(200)
      expect((await res.json()).ok).toBe(true)

      await Invite.deleteMany({ token })
      await User.deleteOne({ _id: user._id })
      bindSession(ctx)
    })

    it('POST rejects owner invite from non-owner admin', async () => {
      bindSession(ctx, 'admin')
      const { POST } = await import('@/lib/route-logic/auth/invite')
      const res = await POST(
        orgJsonReq('/api/auth/invite', 'POST', {
          email: `owner-inv-${Date.now()}@example.com`,
          role: 'owner',
        }),
      )
      expect(res.status).toBe(403)
      bindSession(ctx)
    })

    it('GET returns 400 without token and 404 for unknown token', async () => {
      const { GET } = await import('@/lib/route-logic/auth/invite')
      const noToken = await GET(
        new NextRequest(`${API_ORIGIN}/api/auth/invite`, {
          method: 'GET',
          headers: { host: 'localhost:3000', origin: API_ORIGIN },
        }),
      )
      expect(noToken.status).toBe(400)

      const missing = await GET(
        new NextRequest(`${API_ORIGIN}/api/auth/invite?token=missing-token`, {
          method: 'GET',
          headers: { host: 'localhost:3000', origin: API_ORIGIN },
        }),
      )
      expect(missing.status).toBe(404)
    })

    it('DELETE rejects invalid id query param', async () => {
      bindSession(ctx)
      const { DELETE } = await import('@/lib/route-logic/auth/invite')
      const res = await DELETE(
        orgJsonReq('/api/auth/invite', 'DELETE', undefined, { query: '?id=not-valid' }),
      )
      expect(res.status).toBe(400)
    })
  })

  describe('auth/precheck-2fa', () => {
    it('returns requiresTwoFactor true when password correct and 2FA enabled', async () => {
      const bcrypt = await import('bcryptjs')
      const { User } = await import('@/lib/models')
      const email = `2fa-on-${Date.now()}@example.com`
      const password = 'PrecheckPass123!'
      await User.create({
        email,
        name: '2FA On',
        hashedPassword: await bcrypt.hash(password, 10),
        twoFactorEnabled: true,
      })

      const { POST } = await import('@/lib/route-logic/auth/precheck-2fa')
      const res = await POST(publicJsonReq('/api/auth/precheck-2fa', 'POST', { email, password }))
      expect((await res.json()).requiresTwoFactor).toBe(true)

      await User.deleteOne({ email })
    })
  })
})
