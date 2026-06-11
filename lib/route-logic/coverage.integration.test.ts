import { setNodeEnv } from '@/lib/test/type-helpers'
/**
 * lib/route-logic line-coverage gaps not hit by api-routes / route-logic-finish.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { Types } from 'mongoose'
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

function bindSession(c: ApiTestContext, role: 'owner' | 'admin' | 'member' = 'owner') {
  mockAuth.mockResolvedValue({
    user: {
      id: c.userId,
      email: c.email,
      name: c.userName,
      memberships: [{ o: c.orgId, r: role }],
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
  opts?: { cron?: boolean; query?: string; orgId?: string },
): NextRequest {
  const headers: Record<string, string> = {
    host: 'localhost:3000',
    origin: API_ORIGIN,
    'x-organization-id': opts?.orgId ?? ctx.orgId,
  }
  if (opts?.cron) {
    const secret = process.env.CRON_SECRET || 'test-cron-secret'
    headers['x-cron-secret'] = secret
    headers.authorization = `Bearer ${secret}`
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

function sessionJsonReq(path: string, method: string, body?: unknown, query = ''): NextRequest {
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

describe.sequential('route-logic coverage gaps', () => {
  const year = () => new Date().getFullYear()

  beforeAll(async () => {
    process.env.CRON_SECRET = process.env.CRON_SECRET || 'test-cron-secret'
    process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test'
    process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test'
    process.env.PLATFORM_ADMIN_EMAILS = ''
    ctx = await seedApiRouteFixtures()
    process.env.PLATFORM_ADMIN_EMAILS = ctx.email
        process.env.KASA_TEST_STRIPE_ORG = ctx.orgId
    process.env.KASA_TEST_STRIPE_FAMILY = ctx.fixtures.familyId
    bindSession(ctx)
  })

  afterAll(async () => {
    await teardownApiRouteFixtures()
    vi.restoreAllMocks()
  })

  describe('audit-log', () => {
    it('rate limits, validates filters, paginates, and handles errors', async () => {
      const { AuditLog } = await import('@/lib/models')
      const stamp = Date.now()
      await AuditLog.create([
        {
          organizationId: ctx.orgId,
          userId: ctx.userId,
          action: `gap.audit.${stamp}.a`,
          resourceType: 'Family',
          resourceId: ctx.fixtures.familyId,
        },
        {
          organizationId: ctx.orgId,
          userId: ctx.userId,
          action: `gap.audit.${stamp}.b`,
          resourceType: 'Family',
          resourceId: ctx.fixtures.familyId,
        },
      ])

      const { GET } = await import('@/lib/route-logic/audit-log')

      await withRateLimitBlocked(async () => {
        expect((await GET(orgJsonReq('/api/audit-log', 'GET'))).status).toBe(429)
      })

      expect(
        (await GET(orgJsonReq('/api/audit-log', 'GET', undefined, { query: '?resourceType=123bad' })))
          .status,
      ).toBe(400)

      const y0 = year()
      expect(
        (
          await GET(
            orgJsonReq('/api/audit-log', 'GET', undefined, {
              query: `?fromDate=${y0}-12-31&toDate=${y0}-01-01`,
            }),
          )
        ).status,
      ).toBe(400)

      const action = `gap.audit.${stamp}`
      await AuditLog.create([
        {
          organizationId: ctx.orgId,
          userId: ctx.userId,
          action,
          resourceType: 'Family',
          resourceId: ctx.fixtures.familyId,
        },
        {
          organizationId: ctx.orgId,
          userId: ctx.userId,
          action,
          resourceType: 'Family',
          resourceId: ctx.fixtures.familyId,
        },
      ])
      const first = await GET(
        orgJsonReq('/api/audit-log', 'GET', undefined, {
          query: `?limit=1&action=${encodeURIComponent(action)}`,
        }),
      )
      const page = await first.json()
      expect(page.items.length).toBe(1)
      expect(page.nextCursor).toBeTruthy()
      expect(
        (
          await GET(
            orgJsonReq('/api/audit-log', 'GET', undefined, {
              query: `?limit=1&cursor=${encodeURIComponent(page.nextCursor!)}&action=${encodeURIComponent(action)}`,
            }),
          )
        ).status,
      ).toBe(200)

      const badOidCursor = Buffer.from(
        JSON.stringify({ ts: Date.now(), id: 'not-a-valid-object-id' }),
        'utf8',
      ).toString('base64url')
      expect(
        (await GET(orgJsonReq('/api/audit-log', 'GET', undefined, { query: `?cursor=${badOidCursor}` })))
          .status,
      ).toBe(400)

      const auditMod = await import('@/lib/models')
      const spy = vi.spyOn(auditMod.AuditLog, 'find').mockImplementation(() => {
        throw new Error('audit find failed')
      })
      try {
        expect((await GET(orgJsonReq('/api/audit-log', 'GET'))).status).toBe(500)
      } finally {
        spy.mockRestore()
      }

      await AuditLog.deleteMany({ action: new RegExp(`gap\\.audit\\.${stamp}`) })
      await AuditLog.deleteMany({ action })
    })
  })

  describe('calculations', () => {
    it('auto-computes missing year, paginates list, and rate limits', async () => {
      const { YearlyCalculation } = await import('@/lib/models')
      const y = year() + 50
      await YearlyCalculation.deleteMany({ organizationId: ctx.orgId, year: y })

      const { GET, POST } = await import('@/lib/route-logic/calculations')

      await withRateLimitBlocked(async () => {
        expect((await GET(orgJsonReq('/api/calculations', 'GET'))).status).toBe(429)
      })

      const one = await GET(orgJsonReq('/api/calculations', 'GET', undefined, { query: `?year=${y}` }))
      expect(one.status).toBe(200)

      for (let i = 0; i < 3; i++) {
        await YearlyCalculation.create({
          organizationId: ctx.orgId,
          year: y - i - 1,
          totalIncome: 1,
          totalExpense: 0,
        })
      }
      const list = await GET(orgJsonReq('/api/calculations', 'GET'))
      expect(list.status).toBe(200)

      await withRateLimitBlocked(async () => {
        expect(
          (await POST(orgJsonReq('/api/calculations', 'POST', { year: y, extraDonation: 0, extraExpense: 0 })))
            .status,
        ).toBe(429)
      })

      const calcMod = await import('@/lib/calculations')
      const spy = vi.spyOn(calcMod, 'calculateAndSaveYear').mockRejectedValueOnce(new Error('get fail'))
      try {
        expect((await GET(orgJsonReq('/api/calculations', 'GET', undefined, { query: `?year=${y + 1}` }))).status).toBe(
          500,
        )
      } finally {
        spy.mockRestore()
      }

      await YearlyCalculation.deleteMany({ organizationId: ctx.orgId, year: { $gte: y - 5 } })
    })
  })

  describe('trash', () => {
    it('returns 429 when rate limited', async () => {
      const { GET } = await import('@/lib/route-logic/trash')
      await withRateLimitBlocked(async () => {
        expect((await GET(orgJsonReq('/api/trash', 'GET'))).status).toBe(429)
      })
    })
  })

  describe('notifications member scope', () => {
    it('filters admin-only kinds for members', async () => {
      const { Notification } = await import('@/lib/models')
      const adminKind = 'dispute.opened'
      await Notification.create({
        organizationId: ctx.orgId,
        userId: null,
        kind: adminKind,
        title: 'Admin only',
        body: 'hidden from members',
        readByUserIds: [],
      })

      bindSession(ctx, 'member')
      mockAuth.mockResolvedValueOnce({
        user: {
          id: ctx.fixtures.memberUserId,
          email: 'member@example.com',
          name: 'Member',
          memberships: [{ o: ctx.orgId, r: 'member' }],
        },
      } as never)

      const { GET, POST } = await import('@/lib/route-logic/notifications')
      const list = await GET(orgJsonReq('/api/notifications', 'GET', undefined, { query: '?unreadOnly=true' }))
      expect(list.status).toBe(200)
      const body = await list.json()
      expect(body.items.every((n: { kind: string }) => n.kind !== adminKind)).toBe(true)

      await POST(orgJsonReq('/api/notifications', 'POST', { all: true }))
      bindSession(ctx)
      await Notification.deleteMany({ organizationId: ctx.orgId, kind: adminKind })
    })
  })

  describe('org-members', () => {
    it('rate limits and enforces owner demotion/removal rules', async () => {
      bindSession(ctx)
      const { OrgMembership } = await import('@/lib/models')
      const { GET, PATCH, DELETE } = await import('@/lib/route-logic/org-members')

      await withRateLimitBlocked(async () => {
        expect((await GET(orgJsonReq('/api/org-members', 'GET'))).status).toBe(429)
      })

      const bcrypt = await import('bcryptjs')
      const { User } = await import('@/lib/models')
      const adminUser = await User.create({
        email: `gap-admin-${Date.now()}@example.com`,
        hashedPassword: await bcrypt.hash('ApiRouteTestPass123!', 10),
        name: 'Gap Admin',
      })
      const adminMembership = await OrgMembership.create({
        userId: adminUser._id,
        organizationId: ctx.orgId,
        role: 'admin',
      })
      mockAuth.mockResolvedValueOnce({
        user: {
          id: adminUser._id.toString(),
          email: adminUser.email,
          name: adminUser.name,
          memberships: [{ o: ctx.orgId, r: 'admin' }],
        },
      } as never)

      expect(
        (
          await PATCH(
            orgJsonReq('/api/org-members', 'PATCH', {
              membershipId: ctx.fixtures.membershipId,
              role: 'admin',
            }),
          )
        ).status,
      ).toBe(403)
      bindSession(ctx)

      const realCount = OrgMembership.countDocuments.bind(OrgMembership)
      const countSpy = vi.spyOn(OrgMembership, 'countDocuments').mockImplementation(async (filter: any) => {
        if (filter?.role === 'owner') return 1
        return realCount(filter)
      })
      try {
        await OrgMembership.updateOne({ _id: ctx.fixtures.memberMembershipId }, { $set: { role: 'owner' } })
        expect(
          (
            await PATCH(
              orgJsonReq('/api/org-members', 'PATCH', {
                membershipId: ctx.fixtures.memberMembershipId,
                role: 'admin',
              }),
            )
          ).status,
        ).toBe(400)

        await withRateLimitBlocked(async () => {
          expect(
            (
              await PATCH(
                orgJsonReq('/api/org-members', 'PATCH', {
                  membershipId: ctx.fixtures.memberMembershipId,
                  role: 'member',
                }),
              )
            ).status,
          ).toBe(429)
        })

        await withRateLimitBlocked(async () => {
          expect(
            (await DELETE(orgJsonReq(`/api/org-members?id=${ctx.fixtures.memberMembershipId}`, 'DELETE'))).status,
          ).toBe(429)
        })

        expect(
          (await DELETE(orgJsonReq(`/api/org-members?id=${ctx.fixtures.memberMembershipId}`, 'DELETE'))).status,
        ).toBe(400)
      } finally {
        countSpy.mockRestore()
        await OrgMembership.updateOne({ _id: ctx.fixtures.memberMembershipId }, { $set: { role: 'member' } })
      }

      let ownerChecks = 0
      const raceSpy = vi.spyOn(OrgMembership, 'countDocuments').mockImplementation(async (filter: any) => {
        if (filter?.role === 'owner') {
          ownerChecks++
          if (ownerChecks >= 2) return 0
        }
        return realCount(filter)
      })
      const createSpy = vi.spyOn(OrgMembership, 'create').mockRejectedValueOnce(new Error('revert failed'))
      try {
        await OrgMembership.updateOne({ _id: ctx.fixtures.memberMembershipId }, { $set: { role: 'owner' } })
        const res = await DELETE(orgJsonReq(`/api/org-members?id=${ctx.fixtures.memberMembershipId}`, 'DELETE'))
        expect(res.status).toBe(409)
      } finally {
        createSpy.mockRestore()
        raceSpy.mockRestore()
        await OrgMembership.updateOne({ _id: ctx.fixtures.memberMembershipId }, { $set: { role: 'member' } })
      }

      await OrgMembership.deleteOne({ _id: adminMembership._id })
      await User.deleteOne({ _id: adminUser._id })
    })
  })

  describe('search member results', () => {
    it('includes family names on member hits', async () => {
      const { FamilyMember } = await import('@/lib/models')
      const unique = `GAPSRCH${Date.now()}`
      await FamilyMember.updateOne(
        { _id: ctx.fixtures.memberId },
        { $set: { firstName: unique, lastName: 'Probe' } },
      )
      const { GET } = await import('@/lib/route-logic/search')
      const res = await GET(orgJsonReq('/api/search', 'GET', undefined, { query: `?q=${unique}` }))
      expect(res.status).toBe(200)
      const body = await res.json()
      const memberHit = body.items.find((i: { type: string }) => i.type === 'member')
      expect(memberHit?.label).toBeTruthy()
    })
  })

  describe('tax-receipts empty year', () => {
    it('returns empty list when no payments exist for year', async () => {
      bindSession(ctx)
      const { Payment } = await import('@/lib/models')
      const emptyYear = 2098
      await Payment.deleteMany({ organizationId: ctx.orgId, year: emptyYear })
      const { GET } = await import('@/lib/route-logic/tax-receipts')
      const res = await GET(
        orgJsonReq('/api/tax-receipts', 'GET', undefined, { query: `?year=${emptyYear}` }),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual([])
    })
  })

  describe('auth/precheck-2fa', () => {
    it('returns requiresTwoFactor false for unknown email and missing user', async () => {
      const { POST } = await import('@/lib/route-logic/auth/precheck-2fa')
      const unknown = await POST(
        publicJsonReq('/api/auth/precheck-2fa', 'POST', {
          email: `nobody-${Date.now()}@example.com`,
          password: 'wrong-password',
        }),
      )
      expect(unknown.status).toBe(200)
      expect((await unknown.json()).requiresTwoFactor).toBe(false)

      const bcrypt = await import('bcryptjs')
      const { User } = await import('@/lib/models')
      const no2fa = await User.create({
        email: `no2fa-${Date.now()}@example.com`,
        hashedPassword: await bcrypt.hash('KnownPass123!', 10),
        name: 'No 2FA',
        twoFactorEnabled: false,
      })
      const res = await POST(
        publicJsonReq('/api/auth/precheck-2fa', 'POST', {
          email: no2fa.email,
          password: 'KnownPass123!',
        }),
      )
      expect((await res.json()).requiresTwoFactor).toBe(false)
      await User.deleteOne({ _id: no2fa._id })
    })
  })

  describe('auth/request-invite duplicate', () => {
    it('returns ok when invite already pending', async () => {
      const { InviteRequest } = await import('@/lib/models')
      const email = `pending-${Date.now()}@example.com`
      await InviteRequest.create({ email, name: 'Pending User', status: 'pending' })
      const { POST } = await import('@/lib/route-logic/auth/request-invite')
      const res = await POST(publicJsonReq('/api/auth/request-invite', 'POST', { email, name: 'Pending' }))
      expect(res.status).toBe(200)
      expect((await res.json()).ok).toBe(true)

      await InviteRequest.deleteMany({ email })
    })
  })

  describe('auth/reset-password extended', () => {
    it('handles smtp missing, rate limit, bad token, and used token', async () => {
      const prevSmtp = process.env.PLATFORM_SMTP_URL
      const prevEnv = process.env.NODE_ENV
      delete process.env.PLATFORM_SMTP_URL
      setNodeEnv('production'
)
      const { POST: forgot } = await import('@/lib/route-logic/auth/reset-password')
      const forgotRes = await forgot(
        publicJsonReq('/api/auth/reset-password', 'POST', { email: ctx.email }),
      )
      expect(forgotRes.status).toBe(200)
      if (prevSmtp) process.env.PLATFORM_SMTP_URL = prevSmtp
      else delete process.env.PLATFORM_SMTP_URL
      if (prevEnv) setNodeEnv(prevEnv
)

      const { PUT: reset } = await import('@/lib/route-logic/auth/reset-password')
      await withRateLimitBlocked(async () => {
        expect(
          (
            await reset(
              publicJsonReq('/api/auth/reset-password', 'PUT', {
                token: 'x',
                newPassword: 'NewPass123!zz',
              }),
            )
          ).status,
        ).toBe(429)
      })

      expect(
        (
          await reset(
            publicJsonReq('/api/auth/reset-password', 'PUT', {
              token: 'bad-token',
              newPassword: 'NewPass123!zz',
            }),
          )
        ).status,
      ).toBe(404)

      const crypto = await import('crypto')
      const token = `used-${Date.now()}`
      const { PasswordResetToken } = await import('@/lib/models')
      await PasswordResetToken.create({
        userId: ctx.userId,
        token: crypto.createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + 3600_000),
        usedAt: new Date(),
      })
      expect(
        (
          await reset(
            publicJsonReq('/api/auth/reset-password', 'PUT', {
              token,
              newPassword: 'NewPass123!zz',
            }),
          )
        ).status,
      ).toBe(410)
      await PasswordResetToken.deleteMany({ userId: ctx.userId })
    })
  })

  describe('jobs/wedding-converter lock skip', () => {
    it('returns skipped when job lock held', async () => {
      const { JobLock } = await import('@/lib/models')
      const lockKey = new Date().toISOString().slice(0, 10)
      await JobLock.deleteMany({ jobName: 'wedding-converter', lockKey })
      await JobLock.create({
        jobName: 'wedding-converter',
        lockKey,
        expiresAt: new Date(Date.now() + 3600_000),
      })
      const { POST } = await import('@/lib/route-logic/jobs/wedding-converter')
      const res = await POST(orgJsonReq('/api/jobs/wedding-converter', 'POST', {}, { cron: true }))
      expect((await res.json()).skipped).toBe(true)
      await JobLock.deleteMany({ jobName: 'wedding-converter', lockKey })
    })
  })

  describe('trash purge-all rate limit', () => {
    it('returns 429 when limited', async () => {
      bindSession(ctx)
      const { POST } = await import('@/lib/route-logic/trash/purge-all')
      await withRateLimitBlocked(async () => {
        expect((await POST(orgJsonReq('/api/trash/purge-all', 'POST', {}))).status).toBe(429)
      })
    })
  })

  describe('organizations/branding/logo', () => {
    it('returns 429 when rate limited', async () => {
      bindSession(ctx)
      const { GET } = await import('@/lib/route-logic/organizations/branding/logo')
      await withRateLimitBlocked(async () => {
        expect((await GET(orgJsonReq('/api/organizations/branding/logo', 'GET'))).status).toBe(429)
      })
    })
  })

  describe('user endpoints rate limits', () => {
    it('returns 429 on GET and PATCH', async () => {
      const { GET, PATCH } = await import('@/lib/route-logic/user')
      await withRateLimitBlocked(async () => {
        expect((await GET(sessionJsonReq('/api/user', 'GET'))).status).toBe(429)
        expect((await PATCH(sessionJsonReq('/api/user', 'PATCH', { name: 'X' }))).status).toBe(429)
      })
    })
  })

  describe('bulk rate-limit 429 paths', () => {
    const rateLimitCases: Array<{
      name: string
      run: () => Promise<Response>
    }> = [
        {
          name: 'email-config GET',
          run: async () => {
            const { GET } = await import('@/lib/route-logic/email-config')
            return GET(orgJsonReq('/api/email-config', 'GET'))
          },
        },
        {
          name: 'email-config PUT',
          run: async () => {
            const { PUT } = await import('@/lib/route-logic/email-config')
            return PUT(orgJsonReq('/api/email-config', 'PUT', { email: 'a@b.com', password: 'x', fromName: 'X' }))
          },
        },
                {
          name: 'dues-recommendation',
          run: async () => {
            const { GET } = await import('@/lib/route-logic/dues-recommendation')
            return GET(orgJsonReq('/api/dues-recommendation', 'GET'))
          },
        },
        {
          name: 'events',
          run: async () => {
            const { GET } = await import('@/lib/route-logic/events')
            return GET(orgJsonReq('/api/events', 'GET'))
          },
        },
        {
          name: 'payments list',
          run: async () => {
            const { GET } = await import('@/lib/route-logic/payments')
            return GET(orgJsonReq('/api/payments', 'GET'))
          },
        },
        {
          name: 'statements list',
          run: async () => {
            const { GET } = await import('@/lib/route-logic/statements')
            return GET(orgJsonReq('/api/statements', 'GET'))
          },
        },
        {
          name: 'search',
          run: async () => {
            const { GET } = await import('@/lib/route-logic/search')
            return GET(orgJsonReq('/api/search', 'GET', undefined, { query: '?q=test' }))
          },
        },
        {
          name: 'tax-receipts',
          run: async () => {
            const { GET } = await import('@/lib/route-logic/tax-receipts')
            return GET(orgJsonReq('/api/tax-receipts', 'GET', undefined, { query: `?year=${year()}` }))
          },
        },
                {
          name: 'tasks list',
          run: async () => {
            const { GET } = await import('@/lib/route-logic/tasks')
            return GET(orgJsonReq('/api/tasks', 'GET'))
          },
        },
        {
          name: 'cycle-config GET',
          run: async () => {
            const { GET } = await import('@/lib/route-logic/cycle-config')
            return GET(orgJsonReq('/api/cycle-config', 'GET'))
          },
        },
        {
          name: 'payment-plans GET',
          run: async () => {
            const { GET } = await import('@/lib/route-logic/payment-plans')
            return GET(orgJsonReq('/api/payment-plans', 'GET'))
          },
        },
        {
          name: 'send-file-email',
          run: async () => {
            const { POST } = await import('@/lib/route-logic/send-file-email')
            return POST(orgJsonReq('/api/send-file-email', 'POST', { to: 'a@b.com', subject: 's', body: 'b' }))
          },
        },
      ]

    it.each(rateLimitCases.map((c) => [c.name, c.run] as const))(
      '%s returns 429 when rate limited',
      async (_name, run) => {
        bindSession(ctx)
        await withRateLimitBlocked(async () => {
          expect((await run()).status).toBe(429)
        })
      },
    )
  })

  describe('error-path coverage', () => {
    it('email-config GET returns 500 when findOne throws', async () => {
      bindSession(ctx)
      const { EmailConfig } = await import('@/lib/models')
      const spy = vi.spyOn(EmailConfig, 'findOne').mockRejectedValueOnce(new Error('email cfg fail'))
      try {
        const { GET } = await import('@/lib/route-logic/email-config')
        expect((await GET(orgJsonReq('/api/email-config', 'GET'))).status).toBe(500)
      } finally {
        spy.mockRestore()
      }
    })

    it('dashboard-stats returns partial payload when calc throws', async () => {
      bindSession(ctx)
      const calcMod = await import('@/lib/calculations')
      const spy = vi.spyOn(calcMod, 'calculateYearlyBalance').mockRejectedValueOnce(new Error('dash calc fail'))
      try {
        const { GET } = await import('@/lib/route-logic/dashboard-stats')
        const res = await GET(orgJsonReq('/api/dashboard-stats', 'GET'))
        expect(res.status).toBe(200)
      } finally {
        spy.mockRestore()
      }
    })

    it('lifecycle-event-types GET returns 500 on db error', async () => {
      bindSession(ctx)
      const { LifecycleEvent } = await import('@/lib/models')
      const spy = vi.spyOn(LifecycleEvent, 'find').mockImplementation(() => {
        throw new Error('le find fail')
      })
      try {
        const { GET } = await import('@/lib/route-logic/lifecycle-event-types')
        expect((await GET(orgJsonReq('/api/lifecycle-event-types', 'GET'))).status).toBe(500)
      } finally {
        spy.mockRestore()
      }
    })

    it('tasks rejects invalid relatedFamilyId filter', async () => {
      bindSession(ctx)
      const { GET } = await import('@/lib/route-logic/tasks')
      const res = await GET(
        orgJsonReq('/api/tasks', 'GET', undefined, { query: '?relatedFamilyId=not-valid' }),
      )
      expect(res.status).toBe(400)
    })
  })
})
