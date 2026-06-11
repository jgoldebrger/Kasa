/**
 * Remaining lib/route-logic line-coverage gaps: rate limits (429) and branch edges.
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

function importForm(type: string, csv: string, filename: string, extra?: Record<string, string>): FormData {
  const form = new FormData()
  form.set('type', type)
  form.set('file', new Blob([csv], { type: 'text/csv' }), filename)
  if (extra) {
    for (const [k, v] of Object.entries(extra)) form.set(k, v)
  }
  return form
}

function importReq(form: FormData): NextRequest {
  return new NextRequest(`${API_ORIGIN}/api/import`, {
    method: 'POST',
    headers: {
      host: 'localhost:3000',
      origin: API_ORIGIN,
      'x-organization-id': ctx.orgId,
    },
    body: form,
  })
}

describe.sequential('route-logic remaining coverage', () => {
  const year = () => new Date().getFullYear()
  const today = () => new Date().toISOString().slice(0, 10)

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

  describe('rate-limit 429 paths', () => {
    const cases: Array<{ name: string; run: () => Promise<Response> }> = [
      {
        name: 'payment-plans POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/payment-plans')
          return POST(orgJsonReq('/api/payment-plans', 'POST', { name: 'RL Plan', yearlyPrice: 100 }))
        },
      },
      {
        name: 'families/balances GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/families/balances')
          return GET(orgJsonReq('/api/families/balances', 'GET'))
        },
      },
      {
        name: 'reports/run POST',
        run: async () => {
          const y = year()
          const { POST } = await import('@/lib/route-logic/reports/run')
          return POST(
            orgJsonReq('/api/reports/run', 'POST', {
              source: 'payments',
              aggregate: 'count',
              fromDate: `${y}-01-01`,
              toDate: `${y}-12-31`,
            }),
          )
        },
      },
      {
        name: 'statements/auto-generate GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/statements/auto-generate')
          return GET(
            orgJsonReq('/api/statements/auto-generate', 'GET', undefined, {
              query: `?year=${year()}&month=1`,
            }),
          )
        },
      },
      {
        name: 'statements/send-emails/status GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/statements/send-emails/status')
          return GET(
            orgJsonReq('/api/statements/send-emails/status', 'GET', undefined, {
              query: `?jobId=${ctx.fixtures.familyId}`,
            }),
          )
        },
      },
      {
        name: 'stripe/confirm-payment POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/stripe/confirm-payment')
          return POST(
            orgJsonReq('/api/stripe/confirm-payment', 'POST', {
              paymentIntentId: 'pi_test123',
              familyId: ctx.fixtures.familyId,
            }),
          )
        },
      },
      {
        name: 'stripe/create-payment-intent POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/stripe/create-payment-intent')
          return POST(
            orgJsonReq('/api/stripe/create-payment-intent', 'POST', {
              familyId: ctx.fixtures.familyId,
              amount: 10,
            }),
          )
        },
      },
      {
        name: 'import POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/import')
          return POST(importReq(importForm('families', 'name,weddingDate\nX,2019-01-01', 'r.csv')))
        },
      },
      {
        name: 'tax-receipts/email POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/tax-receipts/email')
          return POST(orgJsonReq('/api/tax-receipts/email', 'POST', { year: year() }))
        },
      },
      {
        name: 'tax-receipts/zip GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/tax-receipts/zip')
          return GET(orgJsonReq('/api/tax-receipts/zip', 'GET', undefined, { query: `?year=${year()}` }))
        },
      },
      {
        name: 'tax-receipts pdf GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/tax-receipts/[familyId]/pdf')
          return GET(
            orgJsonReq(`/api/tax-receipts/${ctx.fixtures.familyId}/pdf`, 'GET', undefined, {
              query: `?year=${year()}`,
            }),
            { params: { familyId: ctx.fixtures.familyId } },
          )
        },
      },
      {
        name: 'organizations GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/organizations')
          return GET(orgJsonReq('/api/organizations', 'GET'))
        },
      },
      {
        name: 'families/[id] GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/families/[id]')
          return GET(orgJsonReq(`/api/families/${ctx.fixtures.familyId}`, 'GET'), {
            params: { id: ctx.fixtures.familyId },
          })
        },
      },
      {
        name: 'families/[id]/payments GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/families/[id]/payments')
          return GET(orgJsonReq(`/api/families/${ctx.fixtures.familyId}/payments`, 'GET'), {
            params: { id: ctx.fixtures.familyId },
          })
        },
      },
      {
        name: 'families/[id]/members GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/families/[id]/members')
          return GET(orgJsonReq(`/api/families/${ctx.fixtures.familyId}/members`, 'GET'), {
            params: { id: ctx.fixtures.familyId },
          })
        },
      },
      {
        name: 'families/[id]/charge-saved-card POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/families/[id]/charge-saved-card')
          return POST(
            orgJsonReq(`/api/families/${ctx.fixtures.familyId}/charge-saved-card`, 'POST', {
              savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
              amount: 5,
            }),
            { params: { id: ctx.fixtures.familyId } },
          )
        },
      },
      {
        name: 'families/[id]/saved-payment-methods GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/families/[id]/saved-payment-methods')
          return GET(orgJsonReq(`/api/families/${ctx.fixtures.familyId}/saved-payment-methods`, 'GET'), {
            params: { id: ctx.fixtures.familyId },
          })
        },
      },
      {
        name: 'families/bulk POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/families/bulk')
          return POST(
            orgJsonReq('/api/families/bulk', 'POST', {
              action: 'setEmailOptOut',
              ids: [ctx.fixtures.familyId],
              emailOptOut: false,
            }),
          )
        },
      },
      {
        name: 'reports/saved GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/reports/saved')
          return GET(orgJsonReq('/api/reports/saved', 'GET'))
        },
      },
      {
        name: 'reports/pl GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/reports/pl')
          return GET(orgJsonReq('/api/reports/pl', 'GET', undefined, { query: `?year=${year()}` }))
        },
      },
      {
        name: 'cycle-config POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/cycle-config')
          return POST(orgJsonReq('/api/cycle-config', 'POST', { cycleStartMonth: 1 }))
        },
      },
      {
        name: 'calculations POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/calculations')
          return POST(
            orgJsonReq('/api/calculations', 'POST', {
              year: year() + 40,
              extraDonation: 0,
              extraExpense: 0,
            }),
          )
        },
      },
      {
        name: 'notifications POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/notifications')
          return POST(orgJsonReq('/api/notifications', 'POST', { all: true }))
        },
      },
      {
        name: 'lifecycle-event-types POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/lifecycle-event-types')
          return POST(
            orgJsonReq('/api/lifecycle-event-types', 'POST', {
              type: `rl_${Date.now()}`,
              name: 'RL',
              amount: 1,
            }),
          )
        },
      },
      {
        name: 'tasks POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/tasks')
          return POST(
            orgJsonReq('/api/tasks', 'POST', {
              title: 'RL task',
              dueDate: today(),
              email: ctx.email,
              priority: 'low',
              status: 'pending',
            }),
          )
        },
      },
      {
        name: 'user GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/user')
          return GET(sessionJsonReq('/api/user', 'GET'))
        },
      },
      {
        name: 'user/preferences PATCH',
        run: async () => {
          const { PATCH } = await import('@/lib/route-logic/user/preferences')
          return PATCH(sessionJsonReq('/api/user/preferences', 'PATCH', { tableColumns: {} }))
        },
      },
      {
        name: 'admin/invite-requests GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/admin/invite-requests')
          return GET(orgJsonReq('/api/admin/invite-requests', 'GET'))
        },
      },
      {
        name: 'trash GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/trash')
          return GET(orgJsonReq('/api/trash', 'GET'))
        },
      },
      {
        name: 'families/[id]/sub-families GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/families/[id]/sub-families')
          return GET(orgJsonReq(`/api/families/${ctx.fixtures.familyId}/sub-families`, 'GET'), {
            params: { id: ctx.fixtures.familyId },
          })
        },
      },
      {
        name: 'family-members/all GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/family-members/all')
          return GET(orgJsonReq('/api/family-members/all', 'GET'))
        },
      },
      {
        name: 'members balance GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/members/[memberId]/balance')
          return GET(orgJsonReq(`/api/members/${ctx.fixtures.memberId}/balance`, 'GET'), {
            params: { memberId: ctx.fixtures.memberId },
          })
        },
      },
      {
        name: 'statements/send-single-email POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/statements/send-single-email')
          return POST(
            orgJsonReq('/api/statements/send-single-email', 'POST', {
              statement: { _id: ctx.fixtures.statementId },
            }),
          )
        },
      },
      {
        name: 'statements/send-emails POST',
        run: async () => {
          const y = year()
          const { POST } = await import('@/lib/route-logic/statements/send-emails')
          return POST(
            orgJsonReq('/api/statements/send-emails', 'POST', {
              fromDate: `${y}-01-01`,
              toDate: `${y}-12-31`,
            }),
          )
        },
      },
      {
        name: 'statements/generate-monthly POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/statements/generate-monthly')
          return POST(orgJsonReq('/api/statements/generate-monthly', 'POST', {}))
        },
      },
      {
        name: 'statements/generate-pdf POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/statements/generate-pdf')
          return POST(
            orgJsonReq('/api/statements/generate-pdf', 'POST', {
              statementId: ctx.fixtures.statementId,
            }),
          )
        },
      },
      {
        name: 'statements/send-monthly-emails POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/statements/send-monthly-emails')
          return POST(orgJsonReq('/api/statements/send-monthly-emails', 'POST', {}))
        },
      },
      {
        name: 'statements list POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/statements')
          return POST(
            orgJsonReq('/api/statements', 'POST', {
              familyId: ctx.fixtures.familyId,
              fromDate: `${year()}-01-01`,
              toDate: today(),
            }),
          )
        },
      },
      {
        name: 'tasks/send-due-date-emails POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/tasks/send-due-date-emails')
          return POST(orgJsonReq('/api/tasks/send-due-date-emails', 'POST', {}, { cron: true }))
        },
      },
      {
        name: 'jobs/wedding-converter POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/jobs/wedding-converter')
          return POST(orgJsonReq('/api/jobs/wedding-converter', 'POST', {}, { cron: true }))
        },
      },
      {
        name: 'jobs/cycle-rollover POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/jobs/cycle-rollover')
          return POST(orgJsonReq('/api/jobs/cycle-rollover', 'POST', {}, { cron: true }))
        },
      },
      {
        name: 'jobs/process-recurring-payments POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/jobs/process-recurring-payments')
          return POST(orgJsonReq('/api/jobs/process-recurring-payments', 'POST', {}, { cron: true }))
        },
      },
      {
        name: 'organizations/branding GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/organizations/branding')
          return GET(orgJsonReq('/api/organizations/branding', 'GET'))
        },
      },
      {
        name: 'organizations/automation GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/organizations/automation')
          return GET(orgJsonReq('/api/organizations/automation', 'GET'))
        },
      },
      {
        name: 'organizations/current GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/organizations/current')
          return GET(orgJsonReq('/api/organizations/current', 'GET'))
        },
      },
      {
        name: 'organizations/letterhead GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/organizations/letterhead')
          return GET(orgJsonReq('/api/organizations/letterhead', 'GET'))
        },
      },
      {
        name: 'families/[id]/lifecycle-events GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/families/[id]/lifecycle-events')
          return GET(orgJsonReq(`/api/families/${ctx.fixtures.familyId}/lifecycle-events`, 'GET'), {
            params: { id: ctx.fixtures.familyId },
          })
        },
      },
      {
        name: 'families/[id]/withdrawals GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/families/[id]/withdrawals')
          return GET(orgJsonReq(`/api/families/${ctx.fixtures.familyId}/withdrawals`, 'GET'), {
            params: { id: ctx.fixtures.familyId },
          })
        },
      },
      {
        name: 'recurring-payments/process POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/recurring-payments/process')
          return POST(orgJsonReq('/api/recurring-payments/process', 'POST', {}))
        },
      },
      {
        name: 'auth/invite POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/auth/invite')
          return POST(
            orgJsonReq('/api/auth/invite', 'POST', {
              email: `rl-${Date.now()}@example.com`,
              role: 'member',
            }),
          )
        },
      },
    ]

    it.each(cases.map((c) => [c.name, c.run] as const))('%s returns 429', async (_name, run) => {
      bindSession(ctx)
      await withRateLimitBlocked(async () => {
        expect((await run()).status).toBe(429)
      })
    })
  })

  describe('branch edges', () => {
    it('dashboard-stats uses live calculation when no saved doc exists', async () => {
      bindSession(ctx)
      const y = year() + 45
      const { YearlyCalculation } = await import('@/lib/models')
      await YearlyCalculation.deleteMany({ organizationId: ctx.orgId, year: y })
      const { GET } = await import('@/lib/route-logic/dashboard-stats')
      const res = await GET(
        orgJsonReq('/api/dashboard-stats', 'GET', undefined, { query: `?year=${y}` }),
      )
      expect(res.status).toBe(200)
    })

    it('calculations list uses compound cursor pages', async () => {
      bindSession(ctx)
      const { YearlyCalculation } = await import('@/lib/models')
      const y = year() + 44
      await YearlyCalculation.deleteMany({ organizationId: ctx.orgId, year: { $gte: y - 3 } })
      for (let i = 0; i < 4; i++) {
        await YearlyCalculation.create({
          organizationId: ctx.orgId,
          year: y - i,
          totalIncome: 10,
          totalExpense: 1,
        })
      }
      const { GET } = await import('@/lib/route-logic/calculations')
      const res = await GET(orgJsonReq('/api/calculations', 'GET'))
      expect(res.status).toBe(200)
      expect((await res.json()).length).toBeGreaterThanOrEqual(4)
      await YearlyCalculation.deleteMany({ organizationId: ctx.orgId, year: { $gte: y - 5 } })
    })

    it('families list paginates with compound cursor', async () => {
      bindSession(ctx)
      const { Family } = await import('@/lib/models')
      const stamp = `RLPG${Date.now()}`
      const created = await Family.create([
        { organizationId: ctx.orgId, name: `${stamp} A`, weddingDate: new Date('2010-01-01') },
        { organizationId: ctx.orgId, name: `${stamp} B`, weddingDate: new Date('2011-01-01') },
        { organizationId: ctx.orgId, name: `${stamp} C`, weddingDate: new Date('2012-01-01') },
      ])
      const { GET } = await import('@/lib/route-logic/families')
      const first = await GET(
        orgJsonReq('/api/families', 'GET', undefined, { query: '?limit=1' }),
      )
      expect(first.status).toBe(200)
      const page = await first.json()
      expect(page.items.length).toBe(1)
      expect(page.nextCursor).toBeTruthy()
      const second = await GET(
        orgJsonReq('/api/families', 'GET', undefined, {
          query: `?limit=1&cursor=${encodeURIComponent(page.nextCursor)}`,
        }),
      )
      expect(second.status).toBe(200)
      await Family.deleteMany({ _id: { $in: created.map((f) => f._id) } })
    })

    it('reports/run rejects invalid date range', async () => {
      bindSession(ctx)
      const y = year()
      const { POST } = await import('@/lib/route-logic/reports/run')
      const res = await POST(
        orgJsonReq('/api/reports/run', 'POST', {
          source: 'payments',
          aggregate: 'count',
          fromDate: `${y}-12-31`,
          toDate: `${y}-01-01`,
        }),
      )
      expect(res.status).toBe(400)
    })

    it('auth/request-invite returns ok when email rate limited', async () => {
      const rateLimit = await import('@/lib/rate-limit')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockImplementation(async (_req, key) => {
        if (key === 'request-invite-email') return { allowed: false, remaining: 0, resetAt: 0 }
        return { allowed: true, remaining: 999, resetAt: 0 }
      })
      try {
        const { POST } = await import('@/lib/route-logic/auth/request-invite')
        const res = await POST(
          publicJsonReq('/api/auth/request-invite', 'POST', {
            email: `capped-${Date.now()}@example.com`,
            name: 'Capped',
          }),
        )
        expect(res.status).toBe(200)
        expect((await res.json()).ok).toBe(true)
      } finally {
        spy.mockRestore()
      }
    })

    it('auth/precheck-2fa returns false when IP or email rate limited', async () => {
      const { POST } = await import('@/lib/route-logic/auth/precheck-2fa')
      const rateLimit = await import('@/lib/rate-limit')
      const ipSpy = vi.spyOn(rateLimit, 'checkRateLimit').mockImplementation(async (_req, key) => {
        if (key === 'precheck-2fa') return { allowed: false, remaining: 0, resetAt: 0 }
        return { allowed: true, remaining: 999, resetAt: 0 }
      })
      try {
        const ipBlocked = await POST(
          publicJsonReq('/api/auth/precheck-2fa', 'POST', {
            email: 'any@example.com',
            password: 'x',
          }),
        )
        expect((await ipBlocked.json()).requiresTwoFactor).toBe(false)
      } finally {
        ipSpy.mockRestore()
      }

      const emailSpy = vi.spyOn(rateLimit, 'checkRateLimit').mockImplementation(async (_req, key) => {
        if (key === 'precheck-2fa-email') return { allowed: false, remaining: 0, resetAt: 0 }
        return { allowed: true, remaining: 999, resetAt: 0 }
      })
      try {
        const emailBlocked = await POST(
          publicJsonReq('/api/auth/precheck-2fa', 'POST', {
            email: 'capped@example.com',
            password: 'x',
          }),
        )
        expect((await emailBlocked.json()).requiresTwoFactor).toBe(false)
      } finally {
        emailSpy.mockRestore()
      }
    })

    it('wedding-converter maps errors in production', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      const { JobLock, FamilyMember } = await import('@/lib/models')
      const lockKey = new Date().toISOString().slice(0, 10)
      await JobLock.deleteMany({ jobName: 'wedding-converter', lockKey })
      const past = new Date()
      past.setFullYear(past.getFullYear() - 1)
      await FamilyMember.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        firstName: 'Wed',
        lastName: 'Convert',
        weddingDate: past,
        convertedToFamily: false,
      })
      const wedding = await import('@/lib/wedding-converter')
      const spy = vi.spyOn(wedding, 'convertMembersOnWeddingDate').mockRejectedValueOnce(
        new Error('pi_secret123 failed'),
      )
      try {
        const { POST } = await import('@/lib/route-logic/jobs/wedding-converter')
        const res = await POST(orgJsonReq('/api/jobs/wedding-converter', 'POST', {}, { cron: true }))
        const body = await res.json()
        expect(body.failed).toBeGreaterThanOrEqual(1)
        expect(body.errors?.[0]?.orgId).toBeTruthy()
        expect(String(body.errors?.[0]?.error ?? '')).toContain('[payment]')
      } finally {
        spy.mockRestore()
        vi.unstubAllEnvs()
        await FamilyMember.deleteMany({
          organizationId: ctx.orgId,
          firstName: 'Wed',
          lastName: 'Convert',
        })
      }
    })

    it('import collects member row validation errors', async () => {
      bindSession(ctx)
      const { POST } = await import('@/lib/route-logic/import')
      const missingNames = await POST(
        importReq(importForm('members', 'familyName,firstName,lastName\nFam,,', 'bad.csv')),
      )
      expect(missingNames.status).toBe(200)
      expect((await missingNames.json()).failed).toBeGreaterThanOrEqual(1)

      const badFamilyId = await POST(
        importReq(
          importForm(
            'members',
            'familyId,firstName,lastName\nnot-valid,John,Doe',
            'bad-fid.csv',
          ),
        ),
      )
      expect((await badFamilyId.json()).failed).toBeGreaterThanOrEqual(1)

      const noFamily = await POST(
        importReq(
          importForm('members', 'firstName,lastName\nOnly,Name', 'no-family.csv'),
        ),
      )
      expect((await noFamily.json()).failed).toBeGreaterThanOrEqual(1)
    })

    it('import collects payment row validation errors', async () => {
      bindSession(ctx)
      const { Family } = await import('@/lib/models')
      const fam = await Family.findOne({ organizationId: ctx.orgId }).select('name')
      const familyName = fam?.name ?? 'API Route Marker Family'
      const { POST } = await import('@/lib/route-logic/import')
      const csv = [
        'familyName,amount,paymentDate,memberId',
        `${familyName},10,2024-06-01,not-valid`,
        `${familyName},bad,2024-06-01,`,
        `${familyName},10,bad-date,`,
      ].join('\n')
      const res = await POST(importReq(importForm('payments', csv, 'pay-errors.csv')))
      expect(res.status).toBe(200)
      expect((await res.json()).failed).toBeGreaterThanOrEqual(2)
    })

    it('charge-saved-card handles duplicate-key ledger miss and task creation failure', async () => {
      bindSession(ctx)
      const { Payment } = await import('@/lib/models')
      const { SavedPaymentMethod } = await import('@/lib/models')
      await SavedPaymentMethod.updateOne(
        { _id: ctx.fixtures.savedPaymentMethodId },
        { $set: { isActive: true, stripePaymentMethodId: 'pm_probemock' } },
      )
      await Payment.deleteMany({ organizationId: ctx.orgId, stripePaymentIntentId: 'pi_dupnoledger' })

      const Stripe = (await import('stripe')).default
      const client = new Stripe('sk_test') as unknown as {
        paymentIntents: { create: ReturnType<typeof vi.fn> }
      }
      client.paymentIntents.create.mockResolvedValueOnce({
        id: 'pi_dupnoledger',
        status: 'succeeded',
        amount: 1500,
        currency: 'usd',
        payment_method: 'pm_probemock',
      })

      const dupErr = Object.assign(new Error('duplicate'), { code: 11000 })
      const createSpy = vi.spyOn(Payment, 'create').mockRejectedValueOnce(dupErr)
      const findSpy = vi.spyOn(Payment, 'findOne').mockResolvedValueOnce(null as never)
      const path = `/api/families/${ctx.fixtures.familyId}/charge-saved-card`
      const { POST } = await import('@/lib/route-logic/families/[id]/charge-saved-card')
      try {
        const ledgerFail = await POST(
          orgJsonReq(path, 'POST', {
            savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
            amount: 15,
            type: 'membership',
            paymentDate: today(),
          }),
          { params: { id: ctx.fixtures.familyId } },
        )
        expect(ledgerFail.status).toBe(500)

        const taskHelpers = await import('@/lib/task-helpers')
        const taskSpy = vi
          .spyOn(taskHelpers, 'createPaymentDeclinedTask')
          .mockRejectedValueOnce(new Error('task create failed'))
        client.paymentIntents.create.mockRejectedValueOnce(new Error('Stripe hard fail'))
        const decline = await POST(
          orgJsonReq(path, 'POST', {
            savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
            amount: 16,
            type: 'membership',
          }),
          { params: { id: ctx.fixtures.familyId } },
        )
        expect(decline.status).toBe(500)
        taskSpy.mockRestore()
      } finally {
        createSpy.mockRestore()
        findSpy.mockRestore()
      }
    })

    it('import handles empty files, oversize rows, and lifecycle edge rows', async () => {
      bindSession(ctx)
      const { POST } = await import('@/lib/route-logic/import')
      const { Family } = await import('@/lib/models')
      const fam = await Family.findOne({ organizationId: ctx.orgId }).select('name')
      const familyName = fam?.name ?? 'API Route Marker Family'

      const empty = await POST(importReq(importForm('families', '', 'empty.csv')))
      expect(empty.status).toBe(400)

      const manyRows =
        'name,weddingDate\n' +
        Array.from({ length: 20_001 }, (_, i) => `Fam${i},2019-01-01`).join('\n')
      const oversize = await POST(importReq(importForm('families', manyRows, 'huge.csv')))
      expect(oversize.status).toBe(413)

      const lifecycleCsv = `familyName,eventType,eventDate,memberId\n${familyName},bar_mitzvah,2024-08-01,not-valid`
      const leRes = await POST(importReq(importForm('lifecycle-events', lifecycleCsv, 'le-mem.csv')))
      expect((await leRes.json()).failed).toBeGreaterThanOrEqual(1)
    })

    it('stripe confirm-payment rejects malformed body and ids', async () => {
      bindSession(ctx)
      const { POST } = await import('@/lib/route-logic/stripe/confirm-payment')
      const noBody = await POST(
        new NextRequest(`${API_ORIGIN}/api/stripe/confirm-payment`, {
          method: 'POST',
          headers: {
            host: 'localhost:3000',
            origin: API_ORIGIN,
            'x-organization-id': ctx.orgId,
          },
        }),
      )
      expect(noBody.status).toBe(400)

      const badFamily = await POST(
        orgJsonReq('/api/stripe/confirm-payment', 'POST', {
          paymentIntentId: 'pi_validformat1',
          familyId: 'not-valid',
        }),
      )
      expect(badFamily.status).toBe(400)

      const badSpm = await POST(
        orgJsonReq('/api/stripe/confirm-payment', 'POST', {
          paymentIntentId: 'pi_validformat2',
          familyId: ctx.fixtures.familyId,
          savedPaymentMethodId: 'not-valid',
        }),
      )
      expect(badSpm.status).toBe(400)

      const badMember = await POST(
        orgJsonReq('/api/stripe/confirm-payment', 'POST', {
          paymentIntentId: 'pi_validformat3',
          familyId: ctx.fixtures.familyId,
          memberId: 'not-valid',
        }),
      )
      expect(badMember.status).toBe(400)
    })

    it('tax-receipts sorts multiple families alphabetically', async () => {
      bindSession(ctx)
      const y = year()
      const { Payment, Family } = await import('@/lib/models')
      const zed = await Family.create({
        organizationId: ctx.orgId,
        name: `ZZZ Receipt ${Date.now()}`,
        weddingDate: new Date('2010-01-01'),
      })
      const alpha = await Family.create({
        organizationId: ctx.orgId,
        name: `AAA Receipt ${Date.now()}`,
        weddingDate: new Date('2010-01-01'),
      })
      await Payment.create([
        {
          organizationId: ctx.orgId,
          familyId: zed._id,
          amount: 25,
          paymentDate: new Date(`${y}-06-01`),
          year: y,
          type: 'donation',
          paymentMethod: 'check',
        },
        {
          organizationId: ctx.orgId,
          familyId: alpha._id,
          amount: 30,
          paymentDate: new Date(`${y}-06-02`),
          year: y,
          type: 'donation',
          paymentMethod: 'check',
        },
      ])
      const { GET } = await import('@/lib/route-logic/tax-receipts')
      const res = await GET(orgJsonReq('/api/tax-receipts', 'GET', undefined, { query: `?year=${y}` }))
      const items = await res.json()
      const names = items.map((i: { familyName: string }) => i.familyName)
      const subset = names.filter((n: string) => n.includes('Receipt'))
      if (subset.length >= 2) {
        expect(subset[0] <= subset[1]).toBe(true)
      }
      await Payment.deleteMany({ familyId: { $in: [zed._id, alpha._id] } })
      await Family.deleteMany({ _id: { $in: [zed._id, alpha._id] } })
    })

    it('invokes compound cursor mappers for list endpoints', async () => {
      bindSession(ctx)
      const pag = await import('@/lib/pagination')
      const orig = pag.collectCompoundCursorPages
      const spy = vi.spyOn(pag, 'collectCompoundCursorPages').mockImplementation(
        async (loadPage, baseFilter, sortField, direction, getCursor, batchSize) => {
          const page = await loadPage(baseFilter, 3)
          if (page[0]) getCursor(page[0] as never)
          return orig(loadPage, baseFilter, sortField, direction, getCursor, batchSize)
        },
      )
      try {
        const { YearlyCalculation, LifecycleEventPayment, Family } = await import('@/lib/models')
        const y = year() + 46
        await YearlyCalculation.create({
          organizationId: ctx.orgId,
          year: y,
          totalIncome: 1,
          totalExpense: 0,
        })
        await LifecycleEventPayment.create({
          organizationId: ctx.orgId,
          familyId: ctx.fixtures.familyId,
          eventType: 'bar_mitzvah',
          eventDate: new Date(`${y}-06-01`),
          year: y,
          amount: 10,
        })
        await Family.create({
          organizationId: ctx.orgId,
          name: `Sub ${Date.now()}`,
          weddingDate: new Date('2015-01-01'),
          parentFamilyId: ctx.fixtures.familyId,
        })

        expect((await (await import('@/lib/route-logic/calculations')).GET(orgJsonReq('/api/calculations', 'GET'))).status).toBe(200)
        expect((await (await import('@/lib/route-logic/events')).GET(orgJsonReq('/api/events', 'GET'))).status).toBe(200)
        expect(
          (
            await (
              await import('@/lib/route-logic/families/[id]/sub-families')
            ).GET(orgJsonReq(`/api/families/${ctx.fixtures.familyId}/sub-families`, 'GET'), {
              params: { id: ctx.fixtures.familyId },
            })
          ).status,
        ).toBe(200)

        await YearlyCalculation.deleteMany({ organizationId: ctx.orgId, year: y })
        await LifecycleEventPayment.deleteMany({ organizationId: ctx.orgId, year: y })
        await Family.deleteMany({ parentFamilyId: ctx.fixtures.familyId, name: /^Sub / })
      } finally {
        spy.mockRestore()
      }
    })

    it('member balance rejects out-of-range asOfDate', async () => {
      bindSession(ctx)
      const { GET } = await import('@/lib/route-logic/members/[memberId]/balance')
      const res = await GET(
        orgJsonReq(`/api/members/${ctx.fixtures.memberId}/balance`, 'GET', undefined, {
          query: '?asOfDate=1800-01-01',
        }),
        { params: { memberId: ctx.fixtures.memberId } },
      )
      expect(res.status).toBe(400)
    })

    it('organizations switch and preferences GET rate limits', async () => {
      const { PATCH } = await import('@/lib/route-logic/organizations')
      await withRateLimitBlocked(async () => {
        expect(
          (
            await PATCH(
              sessionJsonReq('/api/organizations', 'PATCH', { activeOrgId: ctx.orgId }),
            )
          ).status,
        ).toBe(429)
      })

      const { GET } = await import('@/lib/route-logic/user/preferences')
      await withRateLimitBlocked(async () => {
        expect((await GET(sessionJsonReq('/api/user/preferences', 'GET'))).status).toBe(429)
      })
    })

    it('reset-password rejects concurrent token claim', async () => {
      const crypto = await import('crypto')
      const token = `race-${Date.now()}`
      const { PasswordResetToken } = await import('@/lib/models')
      await PasswordResetToken.create({
        userId: ctx.userId,
        token: crypto.createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + 3600_000),
      })
      const { PUT } = await import('@/lib/route-logic/auth/reset-password')
      const mkReq = () =>
        publicJsonReq('/api/auth/reset-password', 'PUT', {
          token,
          newPassword: 'NewRacePass123!',
        })
      const [a, b] = await Promise.all([PUT(mkReq()), PUT(mkReq())])
      const statuses = [a.status, b.status].sort()
      expect(statuses).toEqual([200, 410])
      await PasswordResetToken.deleteMany({ userId: ctx.userId })
    })
  })

  describe('additional rate-limit 429 paths', () => {
    const moreCases: Array<{ name: string; run: () => Promise<Response> }> = [
      {
        name: 'organizations PATCH switch',
        run: async () => {
          const { PATCH } = await import('@/lib/route-logic/organizations')
          return PATCH(sessionJsonReq('/api/organizations', 'PATCH', { activeOrgId: ctx.orgId }))
        },
      },
      {
        name: 'organizations POST create',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/organizations')
          return POST(
            sessionJsonReq('/api/organizations', 'POST', {
              name: `RL Org ${Date.now()}`,
            }),
          )
        },
      },
      {
        name: 'user/preferences GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/user/preferences')
          return GET(sessionJsonReq('/api/user/preferences', 'GET'))
        },
      },
      {
        name: 'user/password PATCH',
        run: async () => {
          const { PATCH } = await import('@/lib/route-logic/user/password')
          return PATCH(
            sessionJsonReq('/api/user/password', 'PATCH', {
              currentPassword: 'wrong',
              newPassword: 'NewPass123!zz',
            }),
          )
        },
      },
      {
        name: 'organizations/current PATCH',
        run: async () => {
          const { PATCH } = await import('@/lib/route-logic/organizations/current')
          return PATCH(orgJsonReq('/api/organizations/current', 'PATCH', { name: 'RL Name' }))
        },
      },
      {
        name: 'organizations/letterhead PUT',
        run: async () => {
          const { PUT } = await import('@/lib/route-logic/organizations/letterhead')
          return PUT(orgJsonReq('/api/organizations/letterhead', 'PUT', { html: '<p>x</p>' }))
        },
      },
      {
        name: 'organizations/branding PUT',
        run: async () => {
          const { PUT } = await import('@/lib/route-logic/organizations/branding')
          return PUT(orgJsonReq('/api/organizations/branding', 'PUT', { primaryColor: '#112233' }))
        },
      },
      {
        name: 'organizations/automation PUT',
        run: async () => {
          const { PUT } = await import('@/lib/route-logic/organizations/automation')
          return PUT(orgJsonReq('/api/organizations/automation', 'PUT', {}))
        },
      },
      {
        name: 'families POST create',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/families')
          return POST(
            orgJsonReq('/api/families', 'POST', {
              name: `RL Fam ${Date.now()}`,
              weddingDate: '2018-01-01',
              paymentPlanId: ctx.fixtures.paymentPlanId,
            }),
          )
        },
      },
      {
        name: 'families/[id] PUT',
        run: async () => {
          const { PUT } = await import('@/lib/route-logic/families/[id]')
          return PUT(
            orgJsonReq(`/api/families/${ctx.fixtures.familyId}`, 'PUT', { name: 'RL Update' }),
            { params: { id: ctx.fixtures.familyId } },
          )
        },
      },
      {
        name: 'families/[id] DELETE',
        run: async () => {
          const { DELETE } = await import('@/lib/route-logic/families/[id]')
          return DELETE(orgJsonReq(`/api/families/${ctx.fixtures.familyId}`, 'DELETE'), {
            params: { id: ctx.fixtures.familyId },
          })
        },
      },
      {
        name: 'tasks/[id] GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/tasks/[id]')
          return GET(orgJsonReq(`/api/tasks/${ctx.fixtures.taskId}`, 'GET'), {
            params: { id: ctx.fixtures.taskId },
          })
        },
      },
      {
        name: 'lifecycle-event-types/[id] GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/lifecycle-event-types/[id]')
          return GET(orgJsonReq(`/api/lifecycle-event-types/${ctx.fixtures.lifecycleEventTypeId}`, 'GET'), {
            params: { id: ctx.fixtures.lifecycleEventTypeId },
          })
        },
      },
      {
        name: 'payment-plans/[id] GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/payment-plans/[id]')
          return GET(orgJsonReq(`/api/payment-plans/${ctx.fixtures.paymentPlanId}`, 'GET'), {
            params: { id: ctx.fixtures.paymentPlanId },
          })
        },
      },
      {
        name: 'reports/saved/[id] PUT',
        run: async () => {
          const y = year()
          const { PUT } = await import('@/lib/route-logic/reports/saved/[id]')
          return PUT(
            orgJsonReq(`/api/reports/saved/${ctx.fixtures.familyId}`, 'PUT', {
              name: 'RL Saved',
              config: {
                source: 'payments',
                aggregate: 'count',
                fromDate: `${y}-01-01`,
                toDate: `${y}-12-31`,
              },
            }),
            { params: { id: ctx.fixtures.familyId } },
          )
        },
      },
      {
        name: 'trash restore POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/trash/[kind]/[id]/restore')
          return POST(
            orgJsonReq(`/api/trash/task/${ctx.fixtures.taskId}/restore`, 'POST', {}),
            { params: { kind: 'task', id: ctx.fixtures.taskId } },
          )
        },
      },
      {
        name: 'trash item GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/trash/[kind]/[id]')
          return GET(orgJsonReq(`/api/trash/task/${ctx.fixtures.taskId}`, 'GET'), {
            params: { kind: 'task', id: ctx.fixtures.taskId },
          })
        },
      },
      {
        name: 'members statements GET',
        run: async () => {
          const { GET } = await import('@/lib/route-logic/members/[memberId]/statements')
          return GET(orgJsonReq(`/api/members/${ctx.fixtures.memberId}/statements`, 'GET'), {
            params: { memberId: ctx.fixtures.memberId },
          })
        },
      },
      {
        name: 'families/[id]/members POST',
        run: async () => {
          const { POST } = await import('@/lib/route-logic/families/[id]/members')
          return POST(
            orgJsonReq(`/api/families/${ctx.fixtures.familyId}/members`, 'POST', {
              firstName: 'RL',
              lastName: 'Member',
              birthDate: '2010-01-01',
              gender: 'male',
            }),
            { params: { id: ctx.fixtures.familyId } },
          )
        },
      },
      {
        name: 'families/[id]/members/[memberId] PUT',
        run: async () => {
          const { PUT } = await import('@/lib/route-logic/families/[id]/members/[memberId]')
          return PUT(
            orgJsonReq(`/api/families/${ctx.fixtures.familyId}/members/${ctx.fixtures.memberId}`, 'PUT', {
              firstName: 'RL',
              lastName: 'Member',
              birthDate: '2010-01-01',
              gender: 'male',
            }),
            { params: { id: ctx.fixtures.familyId, memberId: ctx.fixtures.memberId } },
          )
        },
      },
      {
        name: 'convert-to-family POST',
        run: async () => {
          const { POST } = await import(
            '@/lib/route-logic/families/[id]/members/[memberId]/convert-to-family'
          )
          return POST(
            orgJsonReq(
              `/api/families/${ctx.fixtures.familyId}/members/${ctx.fixtures.memberId}/convert-to-family`,
              'POST',
              { weddingDate: '2024-01-01' },
            ),
            { params: { id: ctx.fixtures.familyId, memberId: ctx.fixtures.memberId } },
          )
        },
      },
    ]

    it.each(moreCases.map((c) => [c.name, c.run] as const))('%s returns 429', async (_name, run) => {
      bindSession(ctx)
      await withRateLimitBlocked(async () => {
        expect((await run()).status).toBe(429)
      })
    })
  })
})
