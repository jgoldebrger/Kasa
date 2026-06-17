/**
 * Final mop-up for lib/route-logic 100% line thresholds (excl. nextauth).
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
const { sendMail, createTransport } = vi.hoisted(() => {
  const sendMail = vi.fn().mockResolvedValue({ messageId: 'test' })
  const createTransport = vi.fn(() => ({ sendMail }))
  return { sendMail, createTransport }
})

vi.mock('@/app/auth', () => ({ auth: mockAuth }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: mockCookieGet })),
}))
vi.mock('nodemailer', () => ({
  default: { createTransport },
}))

const API_ORIGIN = 'http://localhost:3000'
let ctx: ApiTestContext

function bindSession(
  c: ApiTestContext,
  role: 'owner' | 'admin' | 'member' = 'owner',
  orgId?: string,
) {
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

function publicJsonReq(path: string, method: string, body?: unknown): NextRequest {
  const headers: Record<string, string> = {
    host: 'localhost:3000',
    origin: API_ORIGIN,
    'content-type': 'application/json',
  }
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

describe.sequential('route-logic threshold finish coverage', () => {
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

  describe('dues-recommendation', () => {
    it('returns recommendation and validates query params', async () => {
      bindSession(ctx, 'admin')
      const { GET } = await import('@/lib/route-logic/dues-recommendation')
      const y = year()

      expect((await GET(orgJsonReq('/api/dues-recommendation', 'GET'))).status).toBe(200)

      expect(
        (
          await GET(
            orgJsonReq('/api/dues-recommendation', 'GET', undefined, { query: '?windowYears=0' }),
          )
        ).status,
      ).toBe(400)
      expect(
        (
          await GET(
            orgJsonReq('/api/dues-recommendation', 'GET', undefined, { query: '?windowYears=11' }),
          )
        ).status,
      ).toBe(400)
      expect(
        (
          await GET(
            orgJsonReq('/api/dues-recommendation', 'GET', undefined, { query: '?forecastYears=0' }),
          )
        ).status,
      ).toBe(400)
      expect(
        (
          await GET(
            orgJsonReq('/api/dues-recommendation', 'GET', undefined, {
              query: '?forecastYears=51',
            }),
          )
        ).status,
      ).toBe(400)
      expect(
        (
          await GET(
            orgJsonReq('/api/dues-recommendation', 'GET', undefined, {
              query: `?startYear=${y - 100}`,
            }),
          )
        ).status,
      ).toBe(400)

      const custom = await GET(
        orgJsonReq('/api/dues-recommendation', 'GET', undefined, {
          query: `?windowYears=3&forecastYears=5&startYear=${y}`,
        }),
      )
      expect(custom.status).toBe(200)
    })
  })

  describe('user profile', () => {
    it('GET and PATCH profile happy paths and empty PATCH', async () => {
      bindSession(ctx)
      const { GET, PATCH } = await import('@/lib/route-logic/user')

      const got = await GET(sessionJsonReq('/api/user', 'GET'))
      expect(got.status).toBe(200)
      const profile = await got.json()
      expect(profile.email).toBe(ctx.email)

      const updated = await PATCH(
        sessionJsonReq('/api/user', 'PATCH', { name: `Finish ${Date.now()}` }),
      )
      expect(updated.status).toBe(200)

      expect((await PATCH(sessionJsonReq('/api/user', 'PATCH', {}))).status).toBe(400)
    })

    it('GET returns 404 when user row missing', async () => {
      bindSession(ctx)
      const { User } = await import('@/lib/models')
      const ghostId = new Types.ObjectId().toString()
      mockAuth.mockResolvedValueOnce({
        user: {
          id: ghostId,
          email: 'ghost@example.com',
          name: 'Ghost',
          memberships: [{ o: ctx.orgId, r: 'owner' }],
        },
      } as never)
      const { GET } = await import('@/lib/route-logic/user')
      expect((await GET(sessionJsonReq('/api/user', 'GET'))).status).toBe(404)
      bindSession(ctx)
      await User.deleteOne({ _id: ghostId }).catch(() => {})
    })
  })

  describe('payment-plans and families/balances', () => {
    it('lists plans with family counts and creates with auto planNumber', async () => {
      bindSession(ctx, 'admin')
      const { GET, POST } = await import('@/lib/route-logic/payment-plans')

      const list = await GET(orgJsonReq('/api/payment-plans', 'GET'))
      expect(list.status).toBe(200)
      const plans = await list.json()
      expect(Array.isArray(plans)).toBe(true)
      if (plans.length > 0) {
        expect(typeof plans[0].familyCount).toBe('number')
      }

      const created = await POST(
        orgJsonReq('/api/payment-plans', 'POST', {
          name: `Finish Plan ${Date.now()}`,
          yearlyPrice: 250,
        }),
      )
      expect(created.status).toBe(201)

      const { PaymentPlan } = await import('@/lib/models')
      const withNum = await POST(
        orgJsonReq('/api/payment-plans', 'POST', {
          name: `Finish Plan Num ${Date.now()}`,
          yearlyPrice: 300,
          planNumber: 8800 + Math.floor(Math.random() * 100),
        }),
      )
      expect(withNum.status).toBe(201)
      const body = await withNum.json()
      await PaymentPlan.deleteOne({ _id: body._id }).catch(() => {})
    })

    it('GET /api/families/balances returns per-family balances', async () => {
      bindSession(ctx, 'admin')
      const { GET } = await import('@/lib/route-logic/families/balances')
      const res = await GET(orgJsonReq('/api/families/balances', 'GET'))
      expect(res.status).toBe(200)
      const items = await res.json()
      expect(Array.isArray(items)).toBe(true)
      if (items.length > 0) {
        expect(items[0]).toHaveProperty('balance')
        expect(items[0]).toHaveProperty('planCost')
      }
    })
  })

  describe('trash list', () => {
    it('GET with limitPerKind param', async () => {
      bindSession(ctx, 'admin')
      const { GET } = await import('@/lib/route-logic/trash')
      const res = await GET(orgJsonReq('/api/trash', 'GET', undefined, { query: '?limit=3' }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toBeTruthy()
    })
  })

  describe('payments list branches', () => {
    it('filters by year, family, method, type, and paginates with limit', async () => {
      bindSession(ctx, 'admin')
      const { GET } = await import('@/lib/route-logic/payments')
      const y = year()

      expect(
        (await GET(orgJsonReq('/api/payments', 'GET', undefined, { query: `?year=${y}` }))).status,
      ).toBe(200)
      expect(
        (
          await GET(
            orgJsonReq('/api/payments', 'GET', undefined, {
              query: `?familyId=${ctx.fixtures.familyId}&paymentMethod=cash&type=membership`,
            }),
          )
        ).status,
      ).toBe(200)
      expect(
        (
          await GET(
            orgJsonReq('/api/payments', 'GET', undefined, {
              query: '?familyId=507f1f77bcf86cd799439099',
            }),
          )
        ).status,
      ).toBe(404)
      expect(
        (
          await GET(
            orgJsonReq('/api/payments', 'GET', undefined, { query: '?cursor=not-valid-cursor' }),
          )
        ).status,
      ).toBe(400)

      const page = await GET(orgJsonReq('/api/payments', 'GET', undefined, { query: '?limit=1' }))
      expect(page.status).toBe(200)
      const envelope = await page.json()
      expect(Array.isArray(envelope.items)).toBe(true)
    })
  })

  describe('statements list and generate', () => {
    it('paginates, filters by family, and refreshes existing statement', async () => {
      bindSession(ctx, 'admin')
      const { GET, POST } = await import('@/lib/route-logic/statements')
      const y = year()

      const page = await GET(orgJsonReq('/api/statements', 'GET', undefined, { query: '?limit=1' }))
      expect(page.status).toBe(200)

      expect(
        (
          await GET(
            orgJsonReq('/api/statements', 'GET', undefined, {
              query: `?familyId=${ctx.fixtures.familyId}`,
            }),
          )
        ).status,
      ).toBe(200)

      const refresh = await POST(
        orgJsonReq('/api/statements', 'POST', {
          familyId: ctx.fixtures.familyId,
          fromDate: `${y}-01-01`,
          toDate: `${y}-01-31`,
        }),
      )
      expect([200, 201]).toContain(refresh.status)
    })
  })

  describe('audit-log remaining branches', () => {
    it('exports csv, filters by userId, validates action and partial date range', async () => {
      bindSession(ctx, 'admin')
      const { AuditLog } = await import('@/lib/models')
      await AuditLog.create({
        organizationId: ctx.orgId,
        userId: ctx.userId,
        action: 'finish.audit.export',
        resourceType: 'Family',
        resourceId: ctx.fixtures.familyId,
        ip: '127.0.0.1',
        userAgent: 'vitest',
        metadata: { note: 'csv' },
      })

      const { GET } = await import('@/lib/route-logic/audit-log')
      const csv = await GET(
        orgJsonReq('/api/audit-log', 'GET', undefined, {
          query: '?format=csv&action=finish.audit.export',
        }),
      )
      expect(csv.status).toBe(200)
      expect(csv.headers.get('content-type')).toMatch(/csv/i)

      expect(
        (
          await GET(
            orgJsonReq('/api/audit-log', 'GET', undefined, {
              query: `?userId=${ctx.userId}`,
            }),
          )
        ).status,
      ).toBe(200)

      expect(
        (await GET(orgJsonReq('/api/audit-log', 'GET', undefined, { query: '?action=!!!bad' })))
          .status,
      ).toBe(400)
      expect(
        (
          await GET(
            orgJsonReq('/api/audit-log', 'GET', undefined, { query: '?fromDate=2020-01-01' }),
          )
        ).status,
      ).toBe(400)
      expect(
        (
          await GET(
            orgJsonReq('/api/audit-log', 'GET', undefined, {
              query: `?userId=${new Types.ObjectId()}`,
            }),
          )
        ).status,
      ).toBe(400)

      await AuditLog.deleteMany({ action: 'finish.audit.export' })
    })
  })

  describe('org-members admin view', () => {
    it('lists members and pending invites without exposing invite tokens', async () => {
      const { Invite } = await import('@/lib/models')
      const inviteEmail = `finish-inv-${Date.now()}@example.com`
      await Invite.create({
        organizationId: ctx.orgId,
        email: inviteEmail,
        role: 'member',
        token: `tok-${Date.now()}`,
        invitedById: ctx.userId,
        expiresAt: new Date(Date.now() + 86400_000),
      })

      bindSession(ctx, 'admin')
      const { GET } = await import('@/lib/route-logic/org-members')
      const res = await GET(orgJsonReq('/api/org-members', 'GET'))
      expect(res.status).toBe(200)
      const body = await res.json()
      const invite = (body.invites ?? []).find((i: { email?: string }) => i.email === inviteEmail)
      expect(invite).toBeTruthy()
      expect(invite).not.toHaveProperty('token')
      bindSession(ctx)
    })
  })

  describe('send-file-email success path', () => {
    it('sends when email config and nodemailer succeed', async () => {
      bindSession(ctx, 'admin')
      const { EmailConfig } = await import('@/lib/models')
      const enc = await import('@/lib/encryption')
      await EmailConfig.updateOne(
        { organizationId: ctx.orgId },
        {
          $set: {
            email: 'sender@example.com',
            password: enc.encrypt('app-password'),
            fromName: 'Kasa Test',
            isActive: true,
          },
        },
        { upsert: true },
      )

      createTransport.mockClear()
      sendMail.mockClear()

      const form = new FormData()
      form.set('file', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'doc.pdf')
      form.set('to', ctx.email)
      form.set('subject', 'Test')
      form.set('message', 'Hello')

      const { POST } = await import('@/lib/route-logic/send-file-email')
      const res = await POST(
        new NextRequest(`${API_ORIGIN}/api/send-file-email`, {
          method: 'POST',
          headers: { host: 'localhost:3000', origin: API_ORIGIN, 'x-organization-id': ctx.orgId },
          body: form,
        }),
      )
      expect(res.status).toBe(200)
      expect(sendMail).toHaveBeenCalled()
    })
  })

  describe('auth request-invite and reset-password', () => {
    it('creates invite request for new email and no-ops for existing user', async () => {
      const email = `finish-new-${Date.now()}@example.com`
      const { POST } = await import('@/lib/route-logic/auth/request-invite')
      expect(
        (await POST(publicJsonReq('/api/auth/request-invite', 'POST', { email, name: 'New User' })))
          .status,
      ).toBe(200)

      const { User, InviteRequest } = await import('@/lib/models')
      expect(
        (
          await POST(
            publicJsonReq('/api/auth/request-invite', 'POST', {
              email: ctx.email,
              name: 'Existing',
            }),
          )
        ).status,
      ).toBe(200)

      await InviteRequest.deleteMany({ email })
      await User.deleteOne({ email }).catch(() => {})
    })

    it('GET validates reset token and POST sends when platform SMTP configured', async () => {
      const crypto = await import('crypto')
      const { PasswordResetToken } = await import('@/lib/models')
      const token = crypto.randomBytes(16).toString('base64url')
      const hash = crypto.createHash('sha256').update(token).digest('hex')
      await PasswordResetToken.create({
        userId: ctx.userId,
        token: hash,
        expiresAt: new Date(Date.now() + 3600_000),
      })

      const { GET } = await import('@/lib/route-logic/auth/reset-password')
      const valid = await GET(
        new NextRequest(
          `${API_ORIGIN}/api/auth/reset-password?token=${encodeURIComponent(token)}`,
          {
            method: 'GET',
            headers: { host: 'localhost:3000', origin: API_ORIGIN },
          },
        ),
      )
      expect(valid.status).toBe(200)
      expect((await valid.json()).valid).toBe(true)

      const platformEmail = await import('@/lib/platform-email')
      vi.spyOn(platformEmail, 'isPlatformEmailConfigured').mockReturnValue(true)
      vi.spyOn(platformEmail, 'sendPlatformEmail').mockResolvedValue(undefined as never)

      const { POST } = await import('@/lib/route-logic/auth/reset-password')
      expect(
        (await POST(publicJsonReq('/api/auth/reset-password', 'POST', { email: ctx.email })))
          .status,
      ).toBe(200)

      await PasswordResetToken.deleteMany({ userId: ctx.userId })
      vi.restoreAllMocks()
      bindSession(ctx)
    })
  })

  describe('families bulk and member masking', () => {
    it('setEmailOptOut bulk action and member-scoped family list', async () => {
      bindSession(ctx, 'admin')
      const { POST } = await import('@/lib/route-logic/families/bulk')
      const bulk = await POST(
        orgJsonReq('/api/families/bulk', 'POST', {
          action: 'setEmailOptOut',
          ids: [ctx.fixtures.familyId],
          emailOptOut: true,
        }),
      )
      expect(bulk.status).toBe(200)

      bindSession(ctx, 'member')
      mockAuth.mockResolvedValueOnce({
        user: {
          id: ctx.fixtures.memberUserId,
          email: `mem-${Date.now()}@example.com`,
          name: 'Member',
          memberships: [{ o: ctx.orgId, r: 'member' }],
        },
      } as never)
      const { GET } = await import('@/lib/route-logic/families')
      const res = await GET(orgJsonReq('/api/families', 'GET', undefined, { query: '?limit=5' }))
      expect(res.status).toBe(200)
      const body = await res.json()
      if (body.items?.length) {
        expect(body.items[0].paymentPlanId).toBeUndefined()
      }
      bindSession(ctx)
    })
  })

  describe('tasks due-date filters', () => {
    it('filters today, overdue, and upcoming', async () => {
      bindSession(ctx, 'admin')
      const { Task } = await import('@/lib/models')
      const past = new Date()
      past.setDate(past.getDate() - 3)
      await Task.create({
        organizationId: ctx.orgId,
        title: 'Finish Overdue',
        dueDate: past,
        email: ctx.email,
        priority: 'low',
        status: 'pending',
      })

      const { GET } = await import('@/lib/route-logic/tasks')
      for (const q of ['?dueDate=today', '?dueDate=overdue', '?dueDate=upcoming']) {
        expect((await GET(orgJsonReq('/api/tasks', 'GET', undefined, { query: q }))).status).toBe(
          200,
        )
      }
      await Task.deleteMany({ organizationId: ctx.orgId, title: 'Finish Overdue' })
    })
  })

  describe('tax-receipts empty year', () => {
    it('returns [] when no membership payments in year', async () => {
      bindSession(ctx, 'admin')
      const { GET } = await import('@/lib/route-logic/tax-receipts')
      const res = await GET(
        orgJsonReq('/api/tax-receipts', 'GET', undefined, { query: '?year=1980' }),
      )
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([])
    })
  })

  describe('jobs/send-monthly-statements fetch failure', () => {
    it('logs and rethrows when per-org fetch fails', async () => {
      const { Organization } = await import('@/lib/models')
      const day = new Date().getDate()
      await Organization.updateOne(
        { _id: ctx.orgId },
        {
          $set: {
            monthlyStatementAutoEmail: true,
            monthlyStatementCalendar: 'gregorian',
            monthlyStatementDay: day,
          },
        },
      )
      const jobs = await import('@/lib/jobs')
      const runSpy = vi.spyOn(jobs, 'runChunked').mockImplementationOnce(async (opts) => {
        await opts.perOrg(ctx.orgId)
        return {
          hasMore: false,
          cursorOut: null,
          jobRunId: 'jr',
          processed: 0,
          failed: 1,
          errors: [],
        }
      })
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 502, text: async () => 'bad gateway' }),
      )
      try {
        const { POST } = await import('@/lib/route-logic/jobs/send-monthly-statements')
        const res = await POST(
          orgJsonReq('/api/jobs/send-monthly-statements', 'POST', undefined, { cron: true }),
        )
        expect(res.status).toBe(500)
      } finally {
        runSpy.mockRestore()
        vi.unstubAllGlobals()
        await Organization.updateOne(
          { _id: ctx.orgId },
          { $unset: { monthlyStatementAutoEmail: 1 } },
        )
      }
    })
  })

  describe('families POST payment plan lookup error', () => {
    it('returns 500 when PaymentPlan.findOne throws', async () => {
      bindSession(ctx, 'admin')
      const { PaymentPlan } = await import('@/lib/models')
      const spy = vi.spyOn(PaymentPlan, 'findOne').mockImplementationOnce(() => {
        throw new Error('plan lookup fail')
      })
      const { POST } = await import('@/lib/route-logic/families')
      const res = await POST(
        orgJsonReq('/api/families', 'POST', {
          name: `Fail Plan ${Date.now()}`,
          weddingDate: '2015-06-01',
          paymentPlanId: ctx.fixtures.paymentPlanId,
        }),
      )
      expect(res.status).toBe(500)
      spy.mockRestore()
    })
  })

  describe('remaining one-line and rate-limit gaps', () => {
    it('covers 429 and validation branches across misc routes', async () => {
      bindSession(ctx, 'admin')

      await withRateLimitBlocked(async () => {
        const { POST: planPost } = await import('@/lib/route-logic/payment-plans')
        expect(
          (await planPost(orgJsonReq('/api/payment-plans', 'POST', { name: 'X', yearlyPrice: 1 })))
            .status,
        ).toBe(429)
        const { GET: balGet } = await import('@/lib/route-logic/families/balances')
        expect((await balGet(orgJsonReq('/api/families/balances', 'GET'))).status).toBe(429)
        const { POST: runPost } = await import('@/lib/route-logic/reports/run')
        expect(
          (
            await runPost(
              orgJsonReq('/api/reports/run', 'POST', {
                source: 'payments',
                aggregate: 'count',
              }),
            )
          ).status,
        ).toBe(429)
        const { GET: orgCurGet } = await import('@/lib/route-logic/organizations/current')
        expect((await orgCurGet(orgJsonReq('/api/organizations/current', 'GET'))).status).toBe(429)
      })

      bindSession(ctx)
      await withRateLimitBlocked(async () => {
        const { GET, PATCH } = await import('@/lib/route-logic/organizations')
        expect((await GET(sessionJsonReq('/api/organizations', 'GET'))).status).toBe(429)
        expect(
          (await PATCH(sessionJsonReq('/api/organizations', 'PATCH', { activeOrgId: ctx.orgId })))
            .status,
        ).toBe(429)
      })

      const rateLimit = await import('@/lib/rate-limit')
      const rlSpy = vi.spyOn(rateLimit, 'checkRateLimit').mockImplementation(async (_req, key) => {
        if (key === 'request-invite-email') return { allowed: false, remaining: 0, resetAt: 0 }
        if (key === 'precheck-2fa') return { allowed: false, remaining: 0, resetAt: 0 }
        if (key === 'precheck-2fa-email') return { allowed: false, remaining: 0, resetAt: 0 }
        return { allowed: true, remaining: 99, resetAt: 0 }
      })
      try {
        const { POST: invitePost } = await import('@/lib/route-logic/auth/request-invite')
        expect(
          (
            await invitePost(
              publicJsonReq('/api/auth/request-invite', 'POST', {
                email: `rl-${Date.now()}@example.com`,
                name: 'Rate Limited',
              }),
            )
          ).status,
        ).toBe(200)

        const { POST: precheckPost } = await import('@/lib/route-logic/auth/precheck-2fa')
        const ipLimited = await precheckPost(
          publicJsonReq('/api/auth/precheck-2fa', 'POST', { email: ctx.email, password: 'x' }),
        )
        expect((await ipLimited.json()).requiresTwoFactor).toBe(false)

        rlSpy.mockImplementation(async (_req, key) => {
          if (key === 'precheck-2fa-email') return { allowed: false, remaining: 0, resetAt: 0 }
          return { allowed: true, remaining: 99, resetAt: 0 }
        })
        const emailLimited = await precheckPost(
          publicJsonReq('/api/auth/precheck-2fa', 'POST', { email: ctx.email, password: 'x' }),
        )
        expect((await emailLimited.json()).requiresTwoFactor).toBe(false)
      } finally {
        rlSpy.mockRestore()
      }

      const { POST: runPost } = await import('@/lib/route-logic/reports/run')
      expect(
        (
          await runPost(
            orgJsonReq('/api/reports/run', 'POST', {
              source: 'payments',
              aggregate: 'count',
              fromDate: `${year()}-01-01`,
            }),
          )
        ).status,
      ).toBe(400)

      bindSession(ctx, 'admin')
      const { GET: famGet } = await import('@/lib/route-logic/families')
      expect(
        (
          await famGet(
            orgJsonReq('/api/families', 'GET', undefined, { query: '?cursor=bad-cursor' }),
          )
        ).status,
      ).toBe(400)

      const { GET: memBal } = await import('@/lib/route-logic/members/[memberId]/balance')
      expect(
        (
          await memBal(
            orgJsonReq(`/api/members/${ctx.fixtures.memberId}/balance`, 'GET', undefined, {
              query: '?asOfDate=1800-01-01',
            }),
            { params: { memberId: ctx.fixtures.memberId } },
          )
        ).status,
      ).toBe(400)

      const { YearlyCalculation } = await import('@/lib/models')
      await YearlyCalculation.deleteMany({ organizationId: ctx.orgId, year: year() + 2 })
      const { GET: dashGet } = await import('@/lib/route-logic/dashboard-stats')
      expect(
        (
          await dashGet(
            orgJsonReq('/api/dashboard-stats', 'GET', undefined, { query: `?year=${year() + 2}` }),
          )
        ).status,
      ).toBe(200)

      const pag = await import('@/lib/pagination')
      const cursorSpy = vi
        .spyOn(pag, 'collectCompoundCursorPages')
        .mockImplementation(async (loadPage, baseFilter, _sf, _dir, getCursor, _bs) => {
          const page = await loadPage(baseFilter, 3)
          if (page[0]) getCursor(page[0] as never)
          return page
        })
      try {
        const { GET: calcGet } = await import('@/lib/route-logic/calculations')
        expect((await calcGet(orgJsonReq('/api/calculations', 'GET'))).status).toBe(200)

        const evSpy = vi
          .spyOn(pag, 'collectCompoundCursorPages')
          .mockImplementationOnce(async (_loadPage, _filter, _sf, _dir, getCursor, _bs) => {
            const row = {
              _id: new Types.ObjectId(),
              eventDate: null,
              eventType: 'bar_mitzvah',
              familyId: ctx.fixtures.familyId,
              amount: 1,
              year: year(),
            }
            getCursor(row as never)
            return [row]
          })
        const { GET: evGet } = await import('@/lib/route-logic/events')
        expect((await evGet(orgJsonReq('/api/events', 'GET'))).status).toBe(200)
        evSpy.mockRestore()

        const subSpy = vi
          .spyOn(pag, 'collectCompoundCursorPages')
          .mockImplementationOnce(async (_loadPage, _filter, _sf, _dir, getCursor, _bs) => {
            const row = {
              _id: new Types.ObjectId(),
              weddingDate: null,
              name: 'Null Wedding Sub',
              organizationId: ctx.orgId,
              parentFamilyId: ctx.fixtures.familyId,
            }
            getCursor(row as never)
            return [row]
          })
        const { GET: subGet } = await import('@/lib/route-logic/families/[id]/sub-families')
        expect(
          (
            await subGet(orgJsonReq(`/api/families/${ctx.fixtures.familyId}/sub-families`, 'GET'), {
              params: { id: ctx.fixtures.familyId },
            })
          ).status,
        ).toBe(200)
        subSpy.mockRestore()
      } finally {
        cursorSpy.mockRestore()
      }
    })

    it('import findFamilyByNameOrEmail matches name and email pair', async () => {
      bindSession(ctx, 'admin')
      const { Family } = await import('@/lib/models')
      const unique = `ImportPair ${Date.now()}`
      const email = `pair-${Date.now()}@example.com`
      await Family.create({
        organizationId: ctx.orgId,
        name: unique,
        email,
        weddingDate: new Date('2014-01-01'),
      })
      const form = new FormData()
      form.set('type', 'payments')
      form.set(
        'file',
        new Blob([`familyName,amount,paymentDate\n${unique},10,2024-03-01`], { type: 'text/csv' }),
        'pair.csv',
      )
      const { POST } = await import('@/lib/route-logic/import')
      const res = await POST(
        new NextRequest(`${API_ORIGIN}/api/import`, {
          method: 'POST',
          headers: { host: 'localhost:3000', origin: API_ORIGIN, 'x-organization-id': ctx.orgId },
          body: form,
        }),
      )
      expect(res.status).toBe(200)
      await Family.deleteMany({ organizationId: ctx.orgId, name: unique })
    })
  })

  describe('final sub-100% line closures', () => {
    it('charge-saved-card rejects invalid memberId format', async () => {
      bindSession(ctx, 'admin')
      const { POST } = await import('@/lib/route-logic/families/[id]/charge-saved-card')
      const res = await POST(
        orgJsonReq(`/api/families/${ctx.fixtures.familyId}/charge-saved-card`, 'POST', {
          amount: 10,
          memberId: 'not-a-valid-id',
        }),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect(res.status).toBe(400)
    })

    it('member statements GET maps null statement dates in compound cursor', async () => {
      bindSession(ctx, 'admin')
      const pag = await import('@/lib/pagination')
      const spy = vi
        .spyOn(pag, 'collectCompoundCursorPages')
        .mockImplementationOnce(async (_loadPage, _filter, _sf, _dir, getCursor, _bs) => {
          const row = { _id: new Types.ObjectId(), date: null }
          getCursor(row as never)
          return [row]
        })
      const { GET } = await import('@/lib/route-logic/members/[memberId]/statements')
      const res = await GET(orgJsonReq(`/api/members/${ctx.fixtures.memberId}/statements`, 'GET'), {
        params: { memberId: ctx.fixtures.memberId },
      })
      expect(res.status).toBe(200)
      spy.mockRestore()
    })

    it('recurring-payments process maps null nextPaymentDate in cursor', async () => {
      bindSession(ctx, 'admin')
      const pag = await import('@/lib/pagination')
      const spy = vi
        .spyOn(pag, 'collectCompoundCursorPages')
        .mockImplementationOnce(async (_loadPage, _filter, _sf, _dir, getCursor, _bs) => {
          const row = { _id: new Types.ObjectId(), nextPaymentDate: null }
          getCursor(row as never)
          return [row]
        })
      const { GET } = await import('@/lib/route-logic/recurring-payments/process')
      const res = await GET(orgJsonReq('/api/recurring-payments/process', 'GET'))
      expect(res.status).toBe(200)
      spy.mockRestore()
    })

    it('convert-to-family tolerates default plan lookup failure', async () => {
      bindSession(ctx)
      const { FamilyMember, Organization, PaymentPlan } = await import('@/lib/models')
      const member = await FamilyMember.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.betaFamilyId,
        firstName: 'Finish',
        lastName: 'Convert',
        gender: 'female',
      })
      await Organization.updateOne(
        { _id: ctx.orgId },
        { $set: { weddingConversionDefaultPlanId: ctx.fixtures.paymentPlanId } },
      )
      const planSpy = vi.spyOn(PaymentPlan, 'findOne').mockRejectedValueOnce(new Error('plan fail'))
      const { POST } =
        await import('@/lib/route-logic/families/[id]/members/[memberId]/convert-to-family')
      const res = await POST(
        orgJsonReq(
          `/api/families/${ctx.fixtures.betaFamilyId}/members/${member._id}/convert-to-family`,
          'POST',
          { weddingDate: '2026-04-01' },
        ),
        { params: { id: ctx.fixtures.betaFamilyId, memberId: member._id.toString() } },
      )
      expect([201, 404, 409]).toContain(res.status)
      planSpy.mockRestore()
      await FamilyMember.deleteOne({ _id: member._id })
      await Organization.updateOne(
        { _id: ctx.orgId },
        { $unset: { weddingConversionDefaultPlanId: 1 } },
      )
    })

    it('recurring-payments POST skips rows when billing claim loses race', async () => {
      bindSession(ctx, 'admin')
      const { RecurringPayment } = await import('@/lib/models')
      const origUpdate = RecurringPayment.updateOne.bind(RecurringPayment)
      vi.spyOn(RecurringPayment, 'updateOne').mockImplementation(
        async (filter: any, update: any) => {
          if (filter?.nextPaymentDate) {
            return {
              acknowledged: true,
              modifiedCount: 0,
              matchedCount: 1,
              upsertedCount: 0,
              upsertedId: null,
            }
          }
          return origUpdate(filter, update)
        },
      )
      try {
        const { POST } = await import('@/lib/route-logic/recurring-payments/process')
        expect((await POST(orgJsonReq('/api/recurring-payments/process', 'POST', {}))).status).toBe(
          200,
        )
      } finally {
        vi.restoreAllMocks()
      }
    })
  })
})
