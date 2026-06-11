/**

 * Executes every catalogued app/api route handler against in-memory Mongo

 * with mocked NextAuth session + org headers. Drives line coverage for route.ts files.

 */

import crypto from 'crypto'
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { Types } from 'mongoose'

import { getCatalogRoutes } from '@/security/catalog'

import type { ApiRouteEntry } from '@/security/catalog/types'

import {

  seedApiRouteFixtures,

  teardownApiRouteFixtures,

  type ApiTestContext,

} from '@/lib/test/api-route-fixtures'

import {

  expectRouteStatus,

  invokeApiRoute,

  prepareRouteInvocation,

} from '@/lib/test/api-route-harness'

import { getDeepProbes } from '@/lib/test/api-route-deep-probes'

import { runDeepProbe } from '@/lib/test/api-route-deep-harness'
import { buildImportProbeRequest } from '@/lib/test/import-route-probes'
import { generateTotpCode } from '@/lib/totp'
import { NextRequest } from 'next/server'



const mockAuth = vi.hoisted(() => vi.fn())

const mockCookieGet = vi.hoisted(() => vi.fn())



vi.mock('@/app/auth', () => ({

  auth: mockAuth,

  handlers: { GET: vi.fn(), POST: vi.fn() },

  signIn: vi.fn(),

  signOut: vi.fn(),

}))



vi.mock('next/headers', () => ({

  cookies: vi.fn(() => ({

    get: mockCookieGet,

  })),

}))



const API_ORIGIN = 'http://localhost:3000'

function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function sessionJsonReq(
  path: string,
  method: string,
  body?: unknown,
  query = '',
): NextRequest {
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

function orgJsonReq(
  path: string,
  method: string,
  body?: unknown,
  opts?: { cron?: boolean; query?: string },
): NextRequest {
  const headers: Record<string, string> = {
    host: 'localhost:3000',
    origin: API_ORIGIN,
    'x-organization-id': ctx.orgId,
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

async function stripeTestClient() {
  const Stripe = (await import('stripe')).default
  return new Stripe('sk_test') as unknown as {
    paymentIntents: {
      retrieve: ReturnType<typeof vi.fn>
      create: ReturnType<typeof vi.fn>
    }
  }
}

function bindSession(ctx: ApiTestContext) {

  mockAuth.mockResolvedValue({

    user: {

      id: ctx.userId,

      email: ctx.email,

      name: ctx.userName,

      memberships: [

        { o: ctx.orgId, r: 'owner' },

        { o: ctx.betaOrgId, r: 'owner' },

      ],

    },

  } as never)

  mockCookieGet.mockImplementation((name: string) => {

    if (name === 'kasa_active_org') return { value: ctx.orgId }

    return undefined

  })

}



const METHOD_ORDER: Record<string, number> = {

  GET: 0,

  HEAD: 1,

  OPTIONS: 2,

  POST: 3,

  PUT: 4,

  PATCH: 5,

  DELETE: 6,

}



function sortRoutes(routes: ApiRouteEntry[]): ApiRouteEntry[] {

  return [...routes].sort((a, b) => {

    const mo = (METHOD_ORDER[a.method] ?? 99) - (METHOD_ORDER[b.method] ?? 99)

    if (mo !== 0) return mo

    return a.path.localeCompare(b.path)

  })

}



const catalogRoutes = sortRoutes(getCatalogRoutes((r) => r.auth !== 'nextauth' && !r.path.includes('nextauth')))



const deepProbeSpecs = catalogRoutes.flatMap((route) =>

  getDeepProbes(route).map(

    (probe) =>

      [`${route.method} ${route.path} [${probe.label}]`, route, probe.label] as const,

  ),

)



let ctx: ApiTestContext



beforeAll(async () => {

  process.env.CRON_SECRET = process.env.CRON_SECRET || 'test-cron-secret'

  process.env.STRIPE_SECRET_KEY =

    process.env.STRIPE_SECRET_KEY || 'sk_test_api_route_probe'

  process.env.STRIPE_WEBHOOK_SECRET =

    process.env.STRIPE_WEBHOOK_SECRET || 'whsec_api_route_probe'

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



describe.concurrent('API route catalog (integration)', () => {

  it('catalog lists routes to exercise', () => {

    expect(catalogRoutes.length).toBeGreaterThan(100)

  })



  it.concurrent.each(catalogRoutes.map((r) => [`${r.method} ${r.path}`, r] as const))(

    '%s',

    async (_label, route) => {

      const { request, params } = prepareRouteInvocation(route, ctx)

      const response = await invokeApiRoute(route, request, params)

      expectRouteStatus(route, response)

      expect(response.status).toBeLessThan(500)

    },

    120_000,

  )

})



describe.concurrent('API route deep probes (integration)', () => {

  beforeEach(() => bindSession(ctx))


  it('deep probe matrix covers every catalog route', () => {
    expect(deepProbeSpecs.length).toBeGreaterThan(catalogRoutes.length)
    expect(deepProbeSpecs.length).toBeGreaterThan(100)
  })



  it.concurrent.each(deepProbeSpecs)(

    '%s',

    async (_label, route, probeLabel) => {

      const probe = getDeepProbes(route, ctx).find((p) => p.label === probeLabel)

      if (!probe) throw new Error(`Missing deep probe ${probeLabel} for ${route.path}`)

      const { response } = await runDeepProbe(route, probe, ctx)

      expect(response.status).toBeLessThan(500)

      if (route.auth === 'org' || route.auth === 'platform-admin' || route.auth === 'org-or-cron') {

        expect(response.status).not.toBe(401)

      } else {

        expectRouteStatus(route, response)

      }

    },

    120_000,

  )

})

describe.sequential('route-logic extended (integration)', () => {
  it('imports members, payments, and lifecycle-events via CSV', async () => {
    const { POST } = await import('@/lib/route-logic/import')
    for (const label of ['members-csv', 'payments-csv', 'lifecycle-events-csv'] as const) {
      const request = await buildImportProbeRequest(label)
      const res = await POST(request)
      expect(res.status).toBeLessThan(500)
      expect(res.status).not.toBe(401)
    }
  })

  it('imports families from XLSX template', async () => {
    const { POST } = await import('@/lib/route-logic/import')
    const request = await buildImportProbeRequest('families-xlsx')
    const res = await POST(request)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it('enrolls 2FA with setup + enable', async () => {
    const password = 'ApiRouteTestPass123!'
    const { POST: setupPost } = await import('@/lib/route-logic/user/2fa/setup')
    const setupRes = await setupPost(
      new NextRequest('http://localhost:3000/api/user/2fa/setup', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          origin: 'http://localhost:3000',
          'content-type': 'application/json',
          'x-organization-id': ctx.orgId,
        },
        body: JSON.stringify({ password }),
      }),
    )
    expect(setupRes.status).toBe(200)
    const setupBody = await setupRes.json()
    const secret = new URL(setupBody.otpauthUrl as string).searchParams.get('secret')
    expect(secret).toBeTruthy()

    const code = generateTotpCode(secret!)
    const { PATCH } = await import('@/lib/route-logic/user/2fa')
    const enableRes = await PATCH(
      new NextRequest('http://localhost:3000/api/user/2fa', {
        method: 'PATCH',
        headers: {
          host: 'localhost:3000',
          origin: 'http://localhost:3000',
          'content-type': 'application/json',
          'x-organization-id': ctx.orgId,
        },
        body: JSON.stringify({ action: 'enable', code }),
      }),
    )
    expect(enableRes.status).toBe(200)

    const { User } = await import('@/lib/models')
    await User.findByIdAndUpdate(ctx.userId, {
      $unset: { twoFactorSecret: 1, twoFactorBackupCodes: 1, twoFactorLastUsedStep: 1 },
      $set: { twoFactorEnabled: false },
    })
  })

  it('PATCH /api/org-members promotes a member to admin', async () => {
    const { PATCH } = await import('@/lib/route-logic/org-members')
    const res = await PATCH(
      new NextRequest('http://localhost:3000/api/org-members', {
        method: 'PATCH',
        headers: {
          host: 'localhost:3000',
          origin: 'http://localhost:3000',
          'content-type': 'application/json',
          'x-organization-id': ctx.orgId,
        },
        body: JSON.stringify({
          membershipId: ctx.fixtures.memberMembershipId,
          role: 'admin',
        }),
      }),
    )
    expect(res.status).toBe(200)
  })

  it('GET /api/tax-receipts/zip streams a ZIP for the seeded year', async () => {
    const { GET } = await import('@/lib/route-logic/tax-receipts/zip')
    const year = new Date().getFullYear()
    const res = await GET(
      new NextRequest(`http://localhost:3000/api/tax-receipts/zip?year=${year}`, {
        method: 'GET',
        headers: {
          host: 'localhost:3000',
          origin: 'http://localhost:3000',
          'x-organization-id': ctx.orgId,
        },
      }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('zip')
  })
})

/** Gap-order coverage for lowest route-logic files (see coverage-route-logic-summary.js). */
describe.sequential('route-logic row coverage (gap order)', () => {
  beforeEach(() => bindSession(ctx))
  const today = () => new Date().toISOString().slice(0, 10)
  const year = () => new Date().getFullYear()

  beforeEach(async () => {
    bindSession(ctx)
    process.env.KASA_TEST_STRIPE_ORG = ctx.orgId
    process.env.KASA_TEST_STRIPE_FAMILY = ctx.fixtures.familyId
    const stripe = await stripeTestClient()
    vi.mocked(stripe.paymentIntents.retrieve).mockImplementation(async (id: string) => ({
      id,
      status: 'succeeded',
      amount: 10000,
      currency: 'usd',
      payment_method: 'pm_probemock',
      metadata: {
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
      },
    }))
    vi.mocked(stripe.paymentIntents.create).mockImplementation(async () => ({
      id: 'pi_chargesaved01',
      status: 'succeeded',
      amount: 10000,
      currency: 'usd',
      payment_method: 'pm_probemock',
      metadata: {
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
      },
    }))
  })

  describe('stripe/confirm-payment', () => {
    it('returns deduplicated payment for existing PaymentIntent', async () => {
      const { POST } = await import('@/lib/route-logic/stripe/confirm-payment')
      const res = await POST(
        orgJsonReq('/api/stripe/confirm-payment', 'POST', {
          paymentIntentId: 'pi_apiprobemock',
          familyId: ctx.fixtures.familyId,
        }),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.deduplicated).toBe(true)
      expect(body.success).toBe(true)
    })

    it('rejects validation and auth branches', async () => {
      const { POST } = await import('@/lib/route-logic/stripe/confirm-payment')
      const base = { familyId: ctx.fixtures.familyId }

      expect((await POST(orgJsonReq('/api/stripe/confirm-payment', 'POST', {}))).status).toBe(400)
      expect(
        (await POST(orgJsonReq('/api/stripe/confirm-payment', 'POST', { ...base, paymentIntentId: 'bad' })))
          .status,
      ).toBe(400)
      expect(
        (await POST(orgJsonReq('/api/stripe/confirm-payment', 'POST', { paymentIntentId: 'pi_bad_id!' })))
          .status,
      ).toBe(400)
      expect(
        (
          await POST(
            orgJsonReq('/api/stripe/confirm-payment', 'POST', {
              paymentIntentId: 'pi_unknownfamily',
              familyId: '000000000000000000000099',
            }),
          )
        ).status,
      ).toBe(404)
      expect(
        (
          await POST(
            orgJsonReq('/api/stripe/confirm-payment', 'POST', {
              paymentIntentId: 'pi_badyear',
              familyId: ctx.fixtures.familyId,
              year: 1800,
            }),
          )
        ).status,
      ).toBe(400)

      const stripe = await stripeTestClient()
      vi.mocked(stripe.paymentIntents.retrieve).mockResolvedValueOnce({
        id: 'pi_orgmismatch99',
        status: 'succeeded',
        amount: 10000,
        currency: 'usd',
        payment_method: 'pm_probemock',
        metadata: { organizationId: '000000000000000000000099', familyId: ctx.fixtures.familyId },
      } as never)
      expect(
        (
          await POST(
            orgJsonReq('/api/stripe/confirm-payment', 'POST', {
              paymentIntentId: 'pi_orgmismatch99',
              familyId: ctx.fixtures.familyId,
            }),
          )
        ).status,
      ).toBe(403)

      vi.mocked(stripe.paymentIntents.retrieve).mockResolvedValueOnce({
        id: 'pi_familymismatch',
        status: 'succeeded',
        amount: 10000,
        currency: 'usd',
        payment_method: 'pm_probemock',
        metadata: { organizationId: ctx.orgId, familyId: '000000000000000000000099' },
      } as never)
      expect(
        (
          await POST(
            orgJsonReq('/api/stripe/confirm-payment', 'POST', {
              paymentIntentId: 'pi_familymismatch',
              familyId: ctx.fixtures.familyId,
            }),
          )
        ).status,
      ).toBe(403)

      vi.mocked(stripe.paymentIntents.retrieve).mockResolvedValueOnce({
        id: 'pi_notsucceeded',
        status: 'requires_payment_method',
        amount: 5000,
        currency: 'usd',
        metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
      } as never)
      expect(
        (
          await POST(
            orgJsonReq('/api/stripe/confirm-payment', 'POST', {
              paymentIntentId: 'pi_notsucceeded',
              familyId: ctx.fixtures.familyId,
            }),
          )
        ).status,
      ).toBe(400)
    })

    it('creates a new payment when no ledger row exists', async () => {
      const { Payment } = await import('@/lib/models')
      await Payment.deleteMany({
        organizationId: ctx.orgId,
        stripePaymentIntentId: 'pi_rowcoveragenew',
      })

      const stripe = await stripeTestClient()
      vi.mocked(stripe.paymentIntents.retrieve).mockResolvedValueOnce({
        id: 'pi_rowcoveragenew',
        status: 'succeeded',
        amount: 7500,
        currency: 'usd',
        payment_method: 'pm_probemock',
        metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
      } as never)

      const { POST } = await import('@/lib/route-logic/stripe/confirm-payment')
      const res = await POST(
        orgJsonReq('/api/stripe/confirm-payment', 'POST', {
          paymentIntentId: 'pi_rowcoveragenew',
          familyId: ctx.fixtures.familyId,
          paymentDate: today(),
        }),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.payment?.amount).toBe(75)
    })

    it('blocks cross-org PaymentIntent reuse', async () => {
      const { Payment } = await import('@/lib/models')
      await Payment.create({
        organizationId: ctx.betaOrgId,
        familyId: ctx.fixtures.betaFamilyId,
        amount: 10,
        paymentDate: new Date(),
        year: year(),
        type: 'membership',
        paymentMethod: 'credit_card',
        stripePaymentIntentId: 'pi_crossorgblock',
      })

      const stripe = await stripeTestClient()
      vi.mocked(stripe.paymentIntents.retrieve).mockResolvedValueOnce({
        id: 'pi_crossorgblock',
        status: 'succeeded',
        amount: 1000,
        currency: 'usd',
        metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
      } as never)

      const { POST } = await import('@/lib/route-logic/stripe/confirm-payment')
      const res = await POST(
        orgJsonReq('/api/stripe/confirm-payment', 'POST', {
          paymentIntentId: 'pi_crossorgblock',
          familyId: ctx.fixtures.familyId,
        }),
      )
      expect(res.status).toBe(409)
    })
  })

  describe('statements/auto-generate', () => {
    it('POST generates monthly statements', async () => {
      const { POST } = await import('@/lib/route-logic/statements/auto-generate')
      const res = await POST(orgJsonReq('/api/statements/auto-generate', 'POST', {}))
      expect(res.status).toBe(201)
    })

    it('GET validates period params and generates for a month', async () => {
      const { GET } = await import('@/lib/route-logic/statements/auto-generate')
      expect((await GET(orgJsonReq('/api/statements/auto-generate', 'GET', undefined, { query: '?year=1800' }))).status).toBe(400)
      expect((await GET(orgJsonReq('/api/statements/auto-generate', 'GET', undefined, { query: '?year=2024' }))).status).toBe(400)
      expect(
        (await GET(orgJsonReq('/api/statements/auto-generate', 'GET', undefined, { query: '?year=2024&month=13' })))
          .status,
      ).toBe(400)
      const ok = await GET(
        orgJsonReq('/api/statements/auto-generate', 'GET', undefined, { query: `?year=${year()}&month=1` }),
      )
      expect(ok.status).toBe(200)
    })
  })

  describe('recurring-payments/process', () => {
    it('processes due recurring payments', async () => {
      const { RecurringPayment } = await import('@/lib/models')
      const due = new Date()
      due.setDate(due.getDate() - 1)
      await RecurringPayment.deleteMany({ organizationId: ctx.orgId })
      await RecurringPayment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
        amount: 50,
        frequency: 'monthly',
        startDate: due,
        nextPaymentDate: due,
        isActive: true,
      })

      const stripe = await stripeTestClient()
      vi.mocked(stripe.paymentIntents.create).mockResolvedValueOnce({
        id: 'pi_recurringrowtest',
        status: 'succeeded',
        amount: 5000,
        currency: 'usd',
      } as never)

      const { POST } = await import('@/lib/route-logic/recurring-payments/process')
      const res = await POST(orgJsonReq('/api/recurring-payments/process', 'POST', {}))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.processed).toBeGreaterThanOrEqual(0)
    })
  })

  describe('auth/reset-password', () => {
    it('runs request, validate, and confirm flow', async () => {
      const { POST, GET, PUT } = await import('@/lib/route-logic/auth/reset-password')
      const { PasswordResetToken } = await import('@/lib/models')

      const postRes = await POST(
        orgJsonReq('/api/auth/reset-password', 'POST', { email: ctx.email }),
      )
      expect(postRes.status).toBe(200)

      const plain = 'row-coverage-reset-token'
      await PasswordResetToken.deleteMany({ userId: ctx.userId })
      await PasswordResetToken.create({
        userId: new Types.ObjectId(ctx.userId),
        token: hashResetToken(plain),
        expiresAt: new Date(Date.now() + 3600_000),
      })

      const getRes = await GET(
        orgJsonReq('/api/auth/reset-password', 'GET', undefined, {
          query: `?token=${encodeURIComponent(plain)}`,
        }),
      )
      expect(getRes.status).toBe(200)
      expect((await getRes.json()).valid).toBe(true)

      const putRes = await PUT(
        orgJsonReq('/api/auth/reset-password', 'PUT', {
          token: plain,
          newPassword: 'ApiRouteTestPass123!',
        }),
      )
      expect(putRes.status).toBe(200)

      const invalidGet = await GET(
        orgJsonReq('/api/auth/reset-password', 'GET', undefined, { query: '?token=totally-invalid' }),
      )
      expect((await invalidGet.json()).valid).toBe(false)

      const usedPut = await PUT(
        orgJsonReq('/api/auth/reset-password', 'PUT', {
          token: plain,
          newPassword: 'AnotherPass123!',
        }),
      )
      expect(usedPut.status).toBe(410)
    })
  })

  describe('statements/send-monthly-emails + workers', () => {
    it('queues monthly statement emails', async () => {
      const { POST } = await import('@/lib/route-logic/statements/send-monthly-emails')
      const res = await POST(orgJsonReq('/api/statements/send-monthly-emails', 'POST', {}))
      expect([200, 202, 409]).toContain(res.status)
    })

    it('processes a statement EmailJob chunk', async () => {
      const { EmailJob } = await import('@/lib/models')
      const { encrypt } = await import('@/lib/encryption')
      const { EmailConfig } = await import('@/lib/models')
      await EmailConfig.updateOne(
        { organizationId: ctx.orgId },
        { $set: { password: encrypt('app-password-test'), isActive: true } },
      )

      const job = await EmailJob.create({
        organizationId: ctx.orgId,
        userId: new Types.ObjectId(ctx.userId),
        kind: 'statements',
        status: 'queued',
        fromDate: new Date(year(), 0, 1),
        toDate: new Date(),
        totalFamilies: 1,
        pending: [new Types.ObjectId(ctx.fixtures.familyId)],
      })

      const { POST } = await import('@/lib/route-logic/statements/send-emails/worker')
      const res = await POST(
        orgJsonReq('/api/statements/send-emails/worker', 'POST', { jobId: job._id.toString() }),
      )
      expect(res.status).toBeLessThan(500)
    })

    it('processes a tax-receipt EmailJob chunk', async () => {
      const { EmailJob } = await import('@/lib/models')
      const job = await EmailJob.create({
        organizationId: ctx.orgId,
        userId: new Types.ObjectId(ctx.userId),
        kind: 'tax-receipts',
        status: 'queued',
        year: year(),
        totalFamilies: 1,
        pending: [new Types.ObjectId(ctx.fixtures.familyId)],
      })

      const { POST } = await import('@/lib/route-logic/tax-receipts/email/worker')
      const res = await POST(
        orgJsonReq('/api/tax-receipts/email/worker', 'POST', { jobId: job._id.toString() }),
      )
      expect(res.status).toBeLessThan(500)
    })
  })

  describe('reports/pl', () => {
    it('returns P&L by year and by date range', async () => {
      const { GET } = await import('@/lib/route-logic/reports/pl')
      const y = year()
      const byYear = await GET(
        orgJsonReq('/api/reports/pl', 'GET', undefined, { query: `?year=${y}` }),
      )
      expect(byYear.status).toBe(200)
      const yearBody = await byYear.json()
      expect(yearBody.summary.paymentCount).toBeGreaterThanOrEqual(1)

      const byRange = await GET(
        orgJsonReq('/api/reports/pl', 'GET', undefined, {
          query: `?startDate=${y}-01-01&endDate=${y}-12-31`,
        }),
      )
      expect(byRange.status).toBe(200)
      expect((await byRange.json()).transactions.length).toBeGreaterThan(0)
    })

    it('rejects invalid period combinations', async () => {
      const { GET } = await import('@/lib/route-logic/reports/pl')
      const y = year()
      expect((await GET(orgJsonReq('/api/reports/pl', 'GET'))).status).toBe(400)
      expect(
        (await GET(orgJsonReq('/api/reports/pl', 'GET', undefined, { query: '?startDate=2024-01-01' })))
          .status,
      ).toBe(400)
      expect(
        (
          await GET(
            orgJsonReq('/api/reports/pl', 'GET', undefined, {
              query: `?year=${y}&startDate=2024-01-01&endDate=2024-12-31`,
            }),
          )
        ).status,
      ).toBe(400)
      expect((await GET(orgJsonReq('/api/reports/pl', 'GET', undefined, { query: '?year=1800' }))).status).toBe(
        400,
      )
    })
  })

  describe('reports/saved', () => {
    it('lists, creates, updates, and deletes saved reports', async () => {
      const y = year()
      const { GET, POST } = await import('@/lib/route-logic/reports/saved')
      const listRes = await GET(orgJsonReq('/api/reports/saved', 'GET'))
      expect(listRes.status).toBe(200)
      const listBody = await listRes.json()
      expect(Array.isArray(listBody.reports)).toBe(true)

      const createRes = await POST(
        orgJsonReq('/api/reports/saved', 'POST', {
          name: `Row Saved ${Date.now()}`,
          source: 'payments',
          config: {
            source: 'payments',
            aggregate: 'count',
            fromDate: `${y}-01-01`,
            toDate: `${y}-12-31`,
          },
        }),
      )
      expect(createRes.status).toBe(201)
      const created = await createRes.json()
      const reportId = created._id as string

      const badDates = await POST(
        orgJsonReq('/api/reports/saved', 'POST', {
          name: 'Bad range',
          source: 'payments',
          config: { source: 'payments', aggregate: 'count', fromDate: `${y}-12-31`, toDate: `${y}-01-01` },
        }),
      )
      expect(badDates.status).toBe(400)

      const { PUT, DELETE } = await import('@/lib/route-logic/reports/saved/[id]')
      const updateRes = await PUT(
        orgJsonReq(`/api/reports/saved/${reportId}`, 'PUT', {
          name: 'Row Saved Updated',
          config: {
            source: 'payments',
            aggregate: 'sum',
            fromDate: `${y}-01-01`,
            toDate: `${y}-12-31`,
          },
        }),
        { params: { id: reportId } },
      )
      expect(updateRes.status).toBe(200)

      const deleteRes = await DELETE(
        orgJsonReq(`/api/reports/saved/${reportId}`, 'DELETE'),
        { params: { id: reportId } },
      )
      expect(deleteRes.status).toBe(200)
    })
  })

  describe('user/2fa', () => {
    it('enables then disables 2FA with password and TOTP', async () => {
      const password = 'ApiRouteTestPass123!'
      const { POST: setupPost } = await import('@/lib/route-logic/user/2fa/setup')
      const setupRes = await setupPost(
        sessionJsonReq('/api/user/2fa/setup', 'POST', { password }),
      )
      expect(setupRes.status).toBe(200)
      const setupBody = await setupRes.json()
      const secret = new URL(setupBody.otpauthUrl as string).searchParams.get('secret')
      const backupCodes = setupBody.backupCodes as string[]
      expect(secret).toBeTruthy()
      expect(backupCodes.length).toBeGreaterThan(0)

      const enrollCode = generateTotpCode(secret!)
      const { PATCH } = await import('@/lib/route-logic/user/2fa')
      const badEnable = await PATCH(
        sessionJsonReq('/api/user/2fa', 'PATCH', { action: 'enable', code: '000000' }),
      )
      expect(badEnable.status).toBe(401)

      const enableRes = await PATCH(
        sessionJsonReq('/api/user/2fa', 'PATCH', { action: 'enable', code: enrollCode }),
      )
      expect(enableRes.status).toBe(200)

      const { User } = await import('@/lib/models')
      await User.findByIdAndUpdate(ctx.userId, { $unset: { twoFactorLastUsedStep: 1 } })
      const disableCode = generateTotpCode(secret!)
      const disableRes = await PATCH(
        sessionJsonReq('/api/user/2fa', 'PATCH', {
          action: 'disable',
          password,
          code: disableCode,
        }),
      )
      expect(disableRes.status).toBe(200)

      await User.findByIdAndUpdate(ctx.userId, {
        $unset: { twoFactorSecret: 1, twoFactorBackupCodes: 1, twoFactorLastUsedStep: 1 },
        $set: { twoFactorEnabled: false },
      })
    })
  })

  describe('families/.../convert-to-family', () => {
    it('converts a member to a new family', async () => {
      const { FamilyMember } = await import('@/lib/models')
      const member = await FamilyMember.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        firstName: 'Row',
        lastName: 'Convert',
        gender: 'female',
        birthDate: new Date('2002-05-10'),
      })

      const { POST } = await import(
        '@/lib/route-logic/families/[id]/members/[memberId]/convert-to-family'
      )
      const res = await POST(
        orgJsonReq(
          `/api/families/${ctx.fixtures.familyId}/members/${member._id}/convert-to-family`,
          'POST',
          { weddingDate: '2024-08-15', spouseName: 'Alex Partner' },
        ),
        { params: { id: ctx.fixtures.familyId, memberId: member._id.toString() } },
      )
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.newFamily?.name).toContain('Row Convert')
    })

    it('returns 409 when member already converted', async () => {
      const { FamilyMember } = await import('@/lib/models')
      const member = await FamilyMember.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        firstName: 'Already',
        lastName: 'Converted',
        gender: 'male',
        birthDate: new Date('2001-01-01'),
        convertedToFamily: true,
      })
      const { POST } = await import(
        '@/lib/route-logic/families/[id]/members/[memberId]/convert-to-family'
      )
      const res = await POST(
        orgJsonReq(
          `/api/families/${ctx.fixtures.familyId}/members/${member._id}/convert-to-family`,
          'POST',
          { weddingDate: '2024-08-15' },
        ),
        { params: { id: ctx.fixtures.familyId, memberId: member._id.toString() } },
      )
      expect(res.status).toBe(409)
    })

    it('rejects missing wedding date and unknown member', async () => {
      const { POST } = await import(
        '@/lib/route-logic/families/[id]/members/[memberId]/convert-to-family'
      )
      const missingDate = await POST(
        orgJsonReq(
          `/api/families/${ctx.fixtures.familyId}/members/${ctx.fixtures.memberId}/convert-to-family`,
          'POST',
          {},
        ),
        { params: { id: ctx.fixtures.familyId, memberId: ctx.fixtures.memberId } },
      )
      expect(missingDate.status).toBe(400)

      const unknownMember = new Types.ObjectId().toString()
      const notFound = await POST(
        orgJsonReq(
          `/api/families/${ctx.fixtures.familyId}/members/${unknownMember}/convert-to-family`,
          'POST',
          { weddingDate: '2024-01-01' },
        ),
        { params: { id: ctx.fixtures.familyId, memberId: unknownMember } },
      )
      expect(notFound.status).toBe(404)
    })
  })

  describe('audit-log', () => {
    it('returns JSON pages and CSV export', async () => {
      const { AuditLog } = await import('@/lib/models')
      await AuditLog.create({
        organizationId: new Types.ObjectId(ctx.orgId),
        userId: new Types.ObjectId(ctx.userId),
        action: 'payment.create',
        resourceType: 'Payment',
        resourceId: new Types.ObjectId(ctx.fixtures.familyId),
        metadata: { rowCoverage: true },
        ip: '127.0.0.1',
        userAgent: 'vitest',
      })

      const y = year()
      const { GET } = await import('@/lib/route-logic/audit-log')
      const listRes = await GET(
        orgJsonReq('/api/audit-log', 'GET', undefined, {
          query: `?limit=5&action=payment.create&userId=${ctx.userId}&resourceType=Payment&fromDate=${y}-01-01&toDate=${y}-12-31`,
        }),
      )
      expect(listRes.status).toBe(200)
      const page = await listRes.json()
      expect(page.items.length).toBeGreaterThanOrEqual(1)

      if (page.nextCursor) {
        const nextRes = await GET(
          orgJsonReq('/api/audit-log', 'GET', undefined, { query: `?limit=1&cursor=${page.nextCursor}` }),
        )
        expect(nextRes.status).toBe(200)
      }

      const csvRes = await GET(
        orgJsonReq('/api/audit-log', 'GET', undefined, {
          query: `?format=csv&fromDate=${y}-01-01&toDate=${y}-12-31`,
        }),
      )
      expect(csvRes.status).toBe(200)
      expect(csvRes.headers.get('content-type')).toContain('text/csv')
    })

    it('rejects invalid filters', async () => {
      const { GET } = await import('@/lib/route-logic/audit-log')
      expect((await GET(orgJsonReq('/api/audit-log', 'GET', undefined, { query: '?fromDate=2024-01-01' }))).status).toBe(400)
      expect(
        (await GET(orgJsonReq('/api/audit-log', 'GET', undefined, { query: '?action=bad action!' }))).status,
      ).toBe(400)
      expect(
        (await GET(orgJsonReq('/api/audit-log', 'GET', undefined, { query: '?userId=not-an-object-id' }))).status,
      ).toBe(400)
      expect(
        (await GET(orgJsonReq('/api/audit-log', 'GET', undefined, { query: '?cursor=not-valid' }))).status,
      ).toBe(400)
    })
  })

  describe('trash/[kind]/[id]/restore', () => {
    it('restores a soft-deleted task', async () => {
      const { Task } = await import('@/lib/models')
      const { softDeleteOne } = await import('@/lib/recycle-bin')
      const orgCtx = {
        organizationId: ctx.orgId,
        userId: ctx.userId,
        role: 'owner' as const,
        session: {
          user: { id: ctx.userId, email: ctx.email, name: ctx.userName },
        },
      }
      const task = await Task.create({
        organizationId: ctx.orgId,
        title: 'Row Restore Task',
        description: 'trash probe',
        dueDate: new Date(Date.now() + 86400000),
        email: ctx.email,
        priority: 'low',
        status: 'pending',
      })
      await softDeleteOne('task', task._id.toString(), orgCtx)

      const { POST } = await import('@/lib/route-logic/trash/[kind]/[id]/restore')
      const res = await POST(
        orgJsonReq(`/api/trash/task/${task._id}/restore`, 'POST', {}),
        { params: { kind: 'task', id: task._id.toString() } },
      )
      expect(res.status).toBe(200)
      expect((await res.json()).message).toBe('Restored')
    })

    it('rejects invalid kind and missing bin item', async () => {
      const { POST } = await import('@/lib/route-logic/trash/[kind]/[id]/restore')
      const badKind = await POST(
        orgJsonReq(`/api/trash/not-a-kind/${ctx.fixtures.taskId}/restore`, 'POST', {}),
        { params: { kind: 'not-a-kind', id: ctx.fixtures.taskId } },
      )
      expect(badKind.status).toBe(400)

      const missing = await POST(
        orgJsonReq(`/api/trash/task/${new Types.ObjectId()}/restore`, 'POST', {}),
        { params: { kind: 'task', id: new Types.ObjectId().toString() } },
      )
      expect(missing.status).toBe(404)

      const badId = await POST(
        orgJsonReq('/api/trash/task/not-valid/restore', 'POST', {}),
        { params: { kind: 'task', id: 'not-valid' } },
      )
      expect(badId.status).toBe(400)
    })
  })

  describe('trash/[kind]/[id]', () => {
    it('gets and permanently deletes a soft-deleted item', async () => {
      const { Task } = await import('@/lib/models')
      const { softDeleteOne } = await import('@/lib/recycle-bin')
      const orgCtx = {
        organizationId: ctx.orgId,
        userId: ctx.userId,
        role: 'owner' as const,
        session: {
          user: { id: ctx.userId, email: ctx.email, name: ctx.userName },
        },
      }
      const task = await Task.create({
        organizationId: ctx.orgId,
        title: 'Row Purge Task',
        description: 'trash purge probe',
        dueDate: new Date(Date.now() + 86400000),
        email: ctx.email,
        priority: 'low',
        status: 'pending',
      })
      await softDeleteOne('task', task._id.toString(), orgCtx)

      const params = { kind: 'task', id: task._id.toString() }
      const { GET, DELETE } = await import('@/lib/route-logic/trash/[kind]/[id]')

      const getRes = await GET(
        orgJsonReq(`/api/trash/task/${task._id}`, 'GET'),
        { params },
      )
      expect(getRes.status).toBe(200)
      const getBody = await getRes.json()
      expect(getBody._id ?? getBody.id).toBeTruthy()

      const delRes = await DELETE(
        orgJsonReq(`/api/trash/task/${task._id}`, 'DELETE'),
        { params },
      )
      expect(delRes.status).toBe(200)
      expect((await delRes.json()).message).toBe('Permanently deleted')
    })

    it('rejects invalid kind, id, and missing bin items', async () => {
      const { GET, DELETE } = await import('@/lib/route-logic/trash/[kind]/[id]')
      const bogusId = new Types.ObjectId().toString()

      expect(
        (await GET(orgJsonReq(`/api/trash/not-a-kind/${bogusId}`, 'GET'), {
          params: { kind: 'not-a-kind', id: bogusId },
        })).status,
      ).toBe(400)

      expect(
        (await GET(orgJsonReq(`/api/trash/task/not-valid`, 'GET'), {
          params: { kind: 'task', id: 'not-valid' },
        })).status,
      ).toBe(400)

      expect(
        (await GET(orgJsonReq(`/api/trash/task/${bogusId}`, 'GET'), {
          params: { kind: 'task', id: bogusId },
        })).status,
      ).toBe(404)

      expect(
        (await DELETE(orgJsonReq(`/api/trash/task/${bogusId}`, 'DELETE'), {
          params: { kind: 'task', id: bogusId },
        })).status,
      ).toBe(404)
    })
  })

  describe('families/[id]', () => {
    it('returns full ledger for admins and redacted data for members', async () => {
      const params = { id: ctx.fixtures.familyId }
      const { GET } = await import('@/lib/route-logic/families/[id]')

      const adminRes = await GET(orgJsonReq(`/api/families/${ctx.fixtures.familyId}`, 'GET'), {
        params,
      })
      expect(adminRes.status).toBe(200)
      const adminBody = await adminRes.json()
      expect(adminBody.payments.length).toBeGreaterThan(0)
      expect(adminBody.balance).toBeTruthy()

      mockAuth.mockResolvedValueOnce({
        user: {
          id: ctx.fixtures.memberUserId,
          email: 'member@example.com',
          name: 'API Route Member',
          memberships: [{ o: ctx.orgId, r: 'member' }],
        },
      } as never)

      const memberRes = await GET(orgJsonReq(`/api/families/${ctx.fixtures.familyId}`, 'GET'), {
        params,
      })
      expect(memberRes.status).toBe(200)
      const memberBody = await memberRes.json()
      expect(memberBody.payments).toEqual([])
      expect(memberBody.balance.balance).toBe(0)
      bindSession(ctx)
    })

    it('updates, validates, and soft-deletes a family', async () => {
      const { Family } = await import('@/lib/models')
      const disposable = await Family.create({
        organizationId: ctx.orgId,
        name: 'Row Family Detail',
        weddingDate: new Date('2012-05-05'),
        paymentPlanId: ctx.fixtures.paymentPlanId,
      })
      const params = { id: disposable._id.toString() }
      const { GET, PUT, DELETE } = await import('@/lib/route-logic/families/[id]')

      const badId = await GET(orgJsonReq('/api/families/not-valid', 'GET'), {
        params: { id: 'not-valid' },
      })
      expect(badId.status).toBe(400)

      const putRes = await PUT(
        orgJsonReq(`/api/families/${disposable._id}`, 'PUT', { name: 'Row Family Updated' }),
        { params },
      )
      expect(putRes.status).toBe(200)

      const emptyPut = await PUT(
        orgJsonReq(`/api/families/${disposable._id}`, 'PUT', {}),
        { params },
      )
      expect(emptyPut.status).toBe(400)

      const selfParent = await PUT(
        orgJsonReq(`/api/families/${disposable._id}`, 'PUT', {
          parentFamilyId: disposable._id.toString(),
        }),
        { params },
      )
      expect(selfParent.status).toBe(400)

      const badPlan = await PUT(
        orgJsonReq(`/api/families/${disposable._id}`, 'PUT', {
          paymentPlanId: new Types.ObjectId().toString(),
        }),
        { params },
      )
      expect(badPlan.status).toBe(400)

      const delRes = await DELETE(
        orgJsonReq(`/api/families/${disposable._id}`, 'DELETE'),
        { params },
      )
      expect(delRes.status).toBe(200)
      expect((await delRes.json()).message).toContain('recycle bin')
    })
  })

  describe('statements/send-emails', () => {
    it('queues a bulk statement email job', async () => {
      const { EmailJob } = await import('@/lib/models')
      await EmailJob.deleteMany({
        organizationId: ctx.orgId,
        kind: 'statements',
        status: { $in: ['queued', 'running'] },
      })

      const y = year()
      const { POST } = await import('@/lib/route-logic/statements/send-emails')
      const res = await POST(
        orgJsonReq('/api/statements/send-emails', 'POST', {
          fromDate: `${y}-01-01`,
          toDate: `${y}-12-31`,
        }),
      )
      expect([200, 202]).toContain(res.status)
      if (res.status === 202) {
        const body = await res.json()
        expect(body.jobId).toBeTruthy()
        expect(body.status).toBe('queued')
      }
    })

    it('rejects invalid date range body', async () => {
      const { POST } = await import('@/lib/route-logic/statements/send-emails')
      const res = await POST(orgJsonReq('/api/statements/send-emails', 'POST', { fromDate: 'bad' }))
      expect(res.status).toBe(400)
    })
  })

  describe('families/[id]/saved-payment-methods', () => {
    it('lists and validates saved payment method routes', async () => {
      const { SavedPaymentMethod } = await import('@/lib/models')
      await SavedPaymentMethod.updateOne(
        { _id: ctx.fixtures.savedPaymentMethodId },
        { $set: { isActive: true, stripePaymentMethodId: 'pm_probemock' } },
      )

      const familyPath = `/api/families/${ctx.fixtures.familyId}/saved-payment-methods`
      const { GET, POST, DELETE } = await import('@/lib/route-logic/families/[id]/saved-payment-methods')
      const params = { id: ctx.fixtures.familyId }

      const listRes = await GET(orgJsonReq(familyPath, 'GET'), { params })
      expect(listRes.status).toBe(200)
      expect(Array.isArray(await listRes.json())).toBe(true)

      const missingPi = await POST(
        orgJsonReq(familyPath, 'POST', { paymentMethodId: 'pm_probemock' }),
        { params },
      )
      expect(missingPi.status).toBe(400)

      const missingQuery = await DELETE(orgJsonReq(familyPath, 'DELETE'), { params })
      expect(missingQuery.status).toBe(400)

      const badFamily = await GET(
        orgJsonReq(`/api/families/${new Types.ObjectId()}/saved-payment-methods`, 'GET'),
        { params: { id: new Types.ObjectId().toString() } },
      )
      expect(badFamily.status).toBe(404)
    })
  })

  describe('admin/invite-requests', () => {
    beforeAll(async () => {
      process.env.PLATFORM_ADMIN_EMAILS = ctx.email
      const { User } = await import('@/lib/models')
      await User.updateOne({ _id: ctx.userId }, { $set: { twoFactorEnabled: true } })
    })
    afterAll(() => {
      process.env.PLATFORM_ADMIN_EMAILS = ''
    })
    it('lists and approves or rejects invite requests', async () => {
      const { InviteRequest } = await import('@/lib/models')
      const pending = await InviteRequest.create({
        email: `row-pending-${Date.now()}@example.com`,
        name: 'Row Pending',
        message: 'access please',
        status: 'pending',
      })
      const toReject = await InviteRequest.create({
        email: `row-reject-${Date.now()}@example.com`,
        name: 'Row Reject',
        message: 'no thanks',
        status: 'pending',
      })

      const { GET, PATCH } = await import('@/lib/route-logic/admin/invite-requests')
      const listRes = await GET(
        orgJsonReq('/api/admin/invite-requests', 'GET', undefined, { query: '?status=pending' }),
      )
      expect(listRes.status).toBe(200)
      expect((await listRes.json()).requests.length).toBeGreaterThanOrEqual(1)

      const approveRes = await PATCH(
        orgJsonReq('/api/admin/invite-requests', 'PATCH', {
          id: pending._id.toString(),
          action: 'approve',
        }),
      )
      expect(approveRes.status).toBe(200)
      const approveBody = await approveRes.json()
      expect(approveBody.signupCode).toBeTruthy()

      const rejectRes = await PATCH(
        orgJsonReq('/api/admin/invite-requests', 'PATCH', {
          id: toReject._id.toString(),
          action: 'reject',
          rejectReason: 'not a fit',
        }),
      )
      expect(rejectRes.status).toBe(200)
    })
  })

  describe('families/[id]/charge-saved-card', () => {
    it('charges the seeded saved payment method', async () => {
      const { Payment } = await import('@/lib/models')
      await Payment.deleteMany({
        organizationId: ctx.orgId,
        stripePaymentIntentId: 'pi_chargesaved01',
      })

      const path = `/api/families/${ctx.fixtures.familyId}/charge-saved-card`
      const { POST } = await import('@/lib/route-logic/families/[id]/charge-saved-card')
      const res = await POST(
        orgJsonReq(path, 'POST', {
          savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
          amount: 25,
          type: 'membership',
        }),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.payment?.amount).toBe(25)
    })

    it('rejects invalid charge payloads', async () => {
      const path = `/api/families/${ctx.fixtures.familyId}/charge-saved-card`
      const { POST } = await import('@/lib/route-logic/families/[id]/charge-saved-card')
      const params = { id: ctx.fixtures.familyId }

      expect((await POST(orgJsonReq(path, 'POST', {}), { params })).status).toBe(400)
      expect(
        (
          await POST(
            orgJsonReq(path, 'POST', {
              savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
              amount: 200_000,
            }),
            { params },
          )
        ).status,
      ).toBe(400)
      expect(
        (
          await POST(
            orgJsonReq(path, 'POST', {
              savedPaymentMethodId: new Types.ObjectId().toString(),
              amount: 10,
            }),
            { params },
          )
        ).status,
      ).toBe(404)
    })
  })

  describe('org-members', () => {
    it('lists members and enforces role-change rules', async () => {
      const { GET, PATCH, DELETE } = await import('@/lib/route-logic/org-members')

      const listRes = await GET(orgJsonReq('/api/org-members', 'GET'))
      expect(listRes.status).toBe(200)
      const list = await listRes.json()
      expect(list.members.length).toBeGreaterThanOrEqual(1)
      expect(list.invites.length).toBeGreaterThanOrEqual(0)

      const selfPatch = await PATCH(
        orgJsonReq('/api/org-members', 'PATCH', {
          membershipId: ctx.fixtures.membershipId,
          role: 'admin',
        }),
      )
      expect(selfPatch.status).toBe(400)

      const demoteMember = await PATCH(
        orgJsonReq('/api/org-members', 'PATCH', {
          membershipId: ctx.fixtures.memberMembershipId,
          role: 'member',
        }),
      )
      expect(demoteMember.status).toBe(200)

      const deleteSelf = await DELETE(
        orgJsonReq(`/api/org-members?id=${ctx.fixtures.membershipId}`, 'DELETE'),
      )
      expect(deleteSelf.status).toBe(400)

      const deleteMissing = await DELETE(
        orgJsonReq(`/api/org-members?id=${new Types.ObjectId()}`, 'DELETE'),
      )
      expect(deleteMissing.status).toBe(404)
    })

    it('blocks non-owners from promoting to owner', async () => {
      const bcrypt = await import('bcryptjs')
      const { User, OrgMembership } = await import('@/lib/models')
      const hashedPassword = await bcrypt.hash('ApiRouteTestPass123!', 10)
      const adminUser = await User.create({
        email: `row-admin-${Date.now()}@example.com`,
        hashedPassword,
        name: 'Row Admin',
      })
      await OrgMembership.create({
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

      const { PATCH } = await import('@/lib/route-logic/org-members')
      const res = await PATCH(
        orgJsonReq('/api/org-members', 'PATCH', {
          membershipId: ctx.fixtures.memberMembershipId,
          role: 'owner',
        }),
      )
      expect(res.status).toBe(403)
      bindSession(ctx)
    })

    it('removes a disposable org member', async () => {
      const bcrypt = await import('bcryptjs')
      const { User, OrgMembership } = await import('@/lib/models')
      const hashedPassword = await bcrypt.hash('ApiRouteTestPass123!', 10)
      const disposable = await User.create({
        email: `row-remove-${Date.now()}@example.com`,
        hashedPassword,
        name: 'Row Remove Me',
      })
      const membership = await OrgMembership.create({
        userId: disposable._id,
        organizationId: ctx.orgId,
        role: 'member',
      })

      const { DELETE } = await import('@/lib/route-logic/org-members')
      const res = await DELETE(
        orgJsonReq(`/api/org-members?id=${membership._id}`, 'DELETE'),
      )
      expect(res.status).toBe(200)
      expect((await res.json()).ok).toBe(true)
    })
  })

  describe('statements/send-single-email', () => {
    it('sends a statement email when config is valid', async () => {
      const { encrypt } = await import('@/lib/encryption')
      const { EmailConfig } = await import('@/lib/models')
      await EmailConfig.updateOne(
        { organizationId: ctx.orgId },
        { $set: { password: encrypt('app-password-test'), isActive: true } },
      )

      const { POST } = await import('@/lib/route-logic/statements/send-single-email')
      const res = await POST(
        orgJsonReq('/api/statements/send-single-email', 'POST', {
          statement: { _id: ctx.fixtures.statementId },
        }),
      )
      expect(res.status).toBe(200)
      expect((await res.json()).sent).toBe(true)
    })

    it('rejects missing statement', async () => {
      const { POST } = await import('@/lib/route-logic/statements/send-single-email')
      const res = await POST(
        orgJsonReq('/api/statements/send-single-email', 'POST', {
          statement: { _id: new Types.ObjectId().toString() },
        }),
      )
      expect(res.status).toBe(404)
    })
  })

  describe('auth/invite', () => {
    it('creates, resolves, and cancels an org invite', async () => {
      const email = `row-invite-${Date.now()}@example.com`
      const { POST, GET, DELETE } = await import('@/lib/route-logic/auth/invite')

      const createRes = await POST(
        orgJsonReq('/api/auth/invite', 'POST', { email, role: 'member' }),
      )
      expect(createRes.status).toBe(200)
      const created = await createRes.json()
      expect(created.token).toBeTruthy()

      const resolveRes = await GET(
        new NextRequest(
          `${API_ORIGIN}/api/auth/invite?token=${encodeURIComponent(created.token)}`,
          { headers: { host: 'localhost:3000', origin: API_ORIGIN } },
        ),
      )
      expect(resolveRes.status).toBe(200)
      expect((await resolveRes.json()).email).toBe(email)

      const cancelRes = await DELETE(
        orgJsonReq(`/api/auth/invite?id=${created.id}`, 'DELETE'),
      )
      expect(cancelRes.status).toBe(200)
    })

    it('rejects invalid invite acceptance', async () => {
      const { PUT } = await import('@/lib/route-logic/auth/invite')
      const res = await PUT(
        orgJsonReq('/api/auth/invite', 'PUT', {
          token: 'invalid-token',
          password: 'ApiRouteTestPass123!',
          name: 'Invited User',
        }),
      )
      expect(res.status).toBe(404)
    })
  })

  describe('user/preferences', () => {
    it('reads and updates table preferences', async () => {
      const { GET, PATCH } = await import('@/lib/route-logic/user/preferences')

      const getRes = await GET(sessionJsonReq('/api/user/preferences', 'GET'))
      expect(getRes.status).toBe(200)
      expect((await getRes.json()).tableColumns).toBeDefined()

      const patchRes = await PATCH(
        sessionJsonReq('/api/user/preferences', 'PATCH', {
          tableColumns: { families: { name: true, email: false } },
          tableColumnOrder: { families: ['name', 'email'] },
        }),
      )
      expect(patchRes.status).toBe(200)
      const patched = await patchRes.json()
      expect(patched.tableColumns.families?.name).toBe(true)

      const emptyPatch = await PATCH(sessionJsonReq('/api/user/preferences', 'PATCH', {}))
      expect(emptyPatch.status).toBe(400)
    })
  })

  describe('tasks', () => {
    it('lists, filters, and creates tasks', async () => {
      const today = new Date().toISOString().slice(0, 10)
      const { GET, POST } = await import('@/lib/route-logic/tasks')

      const listRes = await GET(orgJsonReq('/api/tasks', 'GET'))
      expect(listRes.status).toBe(200)
      expect(Array.isArray(await listRes.json())).toBe(true)

      const filtered = await GET(
        orgJsonReq('/api/tasks', 'GET', undefined, {
          query: `?status=pending&priority=medium&relatedFamilyId=${ctx.fixtures.familyId}&dueDate=today`,
        }),
      )
      expect(filtered.status).toBe(200)

      const badFilter = await GET(
        orgJsonReq('/api/tasks', 'GET', undefined, { query: '?status=not-a-status' }),
      )
      expect(badFilter.status).toBe(400)

      const createRes = await POST(
        orgJsonReq('/api/tasks', 'POST', {
          title: `Row Task ${Date.now()}`,
          dueDate: today,
          email: ctx.email,
          priority: 'low',
          status: 'pending',
          relatedFamilyId: ctx.fixtures.familyId,
        }),
      )
      expect(createRes.status).toBe(201)
    })
  })

  describe('statements/send-emails/status', () => {
    it('returns job status and marks stale running jobs failed', async () => {
      const { EmailJob } = await import('@/lib/models')
      const { EMAIL_JOB_STALE_AFTER_MS } = await import('@/lib/email-jobs')

      const active = await EmailJob.create({
        organizationId: ctx.orgId,
        userId: new Types.ObjectId(ctx.userId),
        kind: 'statements',
        status: 'queued',
        totalFamilies: 1,
        pending: [new Types.ObjectId(ctx.fixtures.familyId)],
        processed: 0,
        sent: 0,
        failed: 0,
      })

      const { GET } = await import('@/lib/route-logic/statements/send-emails/status')
      const ok = await GET(
        orgJsonReq('/api/statements/send-emails/status', 'GET', undefined, {
          query: `?jobId=${active._id}`,
        }),
      )
      expect(ok.status).toBe(200)
      expect((await ok.json()).jobId).toBe(active._id.toString())

      const stale = await EmailJob.create({
        organizationId: ctx.orgId,
        userId: new Types.ObjectId(ctx.userId),
        kind: 'statements',
        status: 'running',
        totalFamilies: 2,
        pending: [],
        processed: 1,
        sent: 1,
        failed: 0,
      })
      const staleAt = new Date(Date.now() - EMAIL_JOB_STALE_AFTER_MS - 60_000)
      await EmailJob.collection.updateOne(
        { _id: stale._id },
        { $set: { status: 'running', updatedAt: staleAt } },
      )

      const staleRes = await GET(
        orgJsonReq('/api/statements/send-emails/status', 'GET', undefined, {
          query: `?jobId=${stale._id}`,
        }),
      )
      expect(staleRes.status).toBe(200)
      expect((await staleRes.json()).status).toBe('failed')

      const bad = await GET(
        orgJsonReq('/api/statements/send-emails/status', 'GET', undefined, {
          query: '?jobId=not-valid',
        }),
      )
      expect(bad.status).toBe(400)
    })
  })

  describe('payments', () => {
    it('lists payments with filters and pagination', async () => {
      const y = year()
      const { GET } = await import('@/lib/route-logic/payments')

      const listRes = await GET(
        orgJsonReq('/api/payments', 'GET', undefined, {
          query: `?familyId=${ctx.fixtures.familyId}&year=${y}`,
        }),
      )
      expect(listRes.status).toBe(200)
      expect(Array.isArray(await listRes.json())).toBe(true)

      const paged = await GET(
        orgJsonReq('/api/payments', 'GET', undefined, {
          query: `?limit=2&paymentMethod=check`,
        }),
      )
      expect(paged.status).toBe(200)
      const page = await paged.json()
      expect(page.items.length).toBeLessThanOrEqual(2)

      const badCursor = await GET(
        orgJsonReq('/api/payments', 'GET', undefined, { query: '?cursor=not-valid' }),
      )
      expect(badCursor.status).toBe(400)

      const badFamily = await GET(
        orgJsonReq('/api/payments', 'GET', undefined, {
          query: `?familyId=${new Types.ObjectId()}`,
        }),
      )
      expect(badFamily.status).toBe(404)
    })
  })

  describe('user/2fa/setup', () => {
    beforeEach(async () => {
      bindSession(ctx)
      const { User } = await import('@/lib/models')
      await User.updateOne(
        { _id: ctx.userId },
        {
          $set: { twoFactorEnabled: false },
          $unset: { twoFactorSecret: 1, twoFactorBackupCodes: 1, twoFactorLastUsedStep: 1 },
        },
      )
    })

    it('rejects wrong password on setup', async () => {
      const { POST } = await import('@/lib/route-logic/user/2fa/setup')
      const res = await POST(
        sessionJsonReq('/api/user/2fa/setup', 'POST', { password: 'wrong-password' }),
      )
      expect(res.status).toBe(401)
    })

    it('requires reauth when 2FA is already enabled', async () => {
      const password = 'ApiRouteTestPass123!'
      const { POST } = await import('@/lib/route-logic/user/2fa/setup')
      const { PATCH } = await import('@/lib/route-logic/user/2fa')
      const { User } = await import('@/lib/models')

      const setupRes = await POST(sessionJsonReq('/api/user/2fa/setup', 'POST', { password }))
      expect(setupRes.status).toBe(200)
      const secret = new URL((await setupRes.json()).otpauthUrl as string).searchParams.get('secret')
      const enableRes = await PATCH(
        sessionJsonReq('/api/user/2fa', 'PATCH', {
          action: 'enable',
          code: generateTotpCode(secret!),
        }),
      )
      expect(enableRes.status).toBe(200)

      const reauthRes = await POST(sessionJsonReq('/api/user/2fa/setup', 'POST', { password }))
      expect(reauthRes.status).toBe(401)
      expect((await reauthRes.json()).requiresReauth).toBe(true)

      await User.findByIdAndUpdate(ctx.userId, {
        $unset: { twoFactorSecret: 1, twoFactorBackupCodes: 1, twoFactorLastUsedStep: 1 },
        $set: { twoFactorEnabled: false },
      })
    })

    it('re-enrolls with password and backup code when 2FA is enabled', async () => {
      const password = 'ApiRouteTestPass123!'
      const { POST } = await import('@/lib/route-logic/user/2fa/setup')
      const { PATCH } = await import('@/lib/route-logic/user/2fa')
      const { User } = await import('@/lib/models')

      const setupRes = await POST(sessionJsonReq('/api/user/2fa/setup', 'POST', { password }))
      const setupBody = await setupRes.json()
      const secret = new URL(setupBody.otpauthUrl as string).searchParams.get('secret')

      await PATCH(
        sessionJsonReq('/api/user/2fa', 'PATCH', {
          action: 'enable',
          code: generateTotpCode(secret!),
        }),
      )

      await User.findByIdAndUpdate(ctx.userId, { $unset: { twoFactorLastUsedStep: 1 } })
      const reenrollRes = await POST(
        sessionJsonReq('/api/user/2fa/setup', 'POST', {
          password,
          code: generateTotpCode(secret!),
        }),
      )
      expect(reenrollRes.status).toBe(200)
      expect((await reenrollRes.json()).backupCodes.length).toBeGreaterThan(0)

      await User.findByIdAndUpdate(ctx.userId, {
        $unset: { twoFactorSecret: 1, twoFactorBackupCodes: 1, twoFactorLastUsedStep: 1 },
        $set: { twoFactorEnabled: false },
      })
    })
  })

  describe('families/bulk', () => {
    it('sets payment plan and email opt-out in bulk', async () => {
      const { POST } = await import('@/lib/route-logic/families/bulk')

      const planRes = await POST(
        orgJsonReq('/api/families/bulk', 'POST', {
          action: 'setPaymentPlan',
          ids: [ctx.fixtures.familyId],
          paymentPlanId: ctx.fixtures.paymentPlanId,
        }),
      )
      expect(planRes.status).toBe(200)

      const optRes = await POST(
        orgJsonReq('/api/families/bulk', 'POST', {
          action: 'setEmailOptOut',
          ids: [ctx.fixtures.familyId],
          emailOptOut: true,
        }),
      )
      expect(optRes.status).toBe(200)

      const badPlan = await POST(
        orgJsonReq('/api/families/bulk', 'POST', {
          action: 'setPaymentPlan',
          ids: [ctx.fixtures.familyId],
          paymentPlanId: new Types.ObjectId().toString(),
        }),
      )
      expect(badPlan.status).toBe(404)
    })

    it('soft-deletes a disposable family via bulk delete', async () => {
      const { Family } = await import('@/lib/models')
      const disposable = await Family.create({
        organizationId: ctx.orgId,
        name: 'Bulk Delete Family',
        weddingDate: new Date('2010-01-01'),
      })

      const { POST } = await import('@/lib/route-logic/families/bulk')
      const res = await POST(
        orgJsonReq('/api/families/bulk', 'POST', {
          action: 'delete',
          ids: [disposable._id.toString()],
        }),
      )
      expect(res.status).toBe(200)
      expect((await res.json()).modified).toBe(1)
    })
  })

  describe('statements', () => {
    it('lists and generates statements', async () => {
      const y = year()
      const { GET, POST } = await import('@/lib/route-logic/statements')

      const listRes = await GET(
        orgJsonReq('/api/statements', 'GET', undefined, {
          query: `?familyId=${ctx.fixtures.familyId}&limit=5`,
        }),
      )
      expect(listRes.status).toBe(200)
      const listed = await listRes.json()
      expect(listed.items?.length ?? listed.length).toBeGreaterThan(0)

      const genRes = await POST(
        orgJsonReq('/api/statements', 'POST', {
          familyId: ctx.fixtures.familyId,
          fromDate: `${y}-03-01`,
          toDate: `${y}-03-31`,
        }),
      )
      expect([200, 201]).toContain(genRes.status)

      const dupRes = await POST(
        orgJsonReq('/api/statements', 'POST', {
          familyId: ctx.fixtures.familyId,
          fromDate: `${y}-03-01`,
          toDate: `${y}-03-31`,
        }),
      )
      expect(dupRes.status).toBe(200)
    })
  })

  describe('email workers (expanded)', () => {
    async function seedEmailConfig() {
      const { encrypt } = await import('@/lib/encryption')
      const { EmailConfig } = await import('@/lib/models')
      await EmailConfig.updateOne(
        { organizationId: ctx.orgId },
        {
          $set: {
            email: 'sender@example.com',
            password: encrypt('app-password-test'),
            fromName: 'API Route Org',
            isActive: true,
          },
        },
        { upsert: true },
      )
    }

    it('completes a single-family statement EmailJob', async () => {
      await seedEmailConfig()
      const { EmailJob } = await import('@/lib/models')
      const y = year()
      const job = await EmailJob.create({
        organizationId: ctx.orgId,
        userId: new Types.ObjectId(ctx.userId),
        kind: 'statements',
        status: 'queued',
        fromDate: new Date(`${y}-01-01`),
        toDate: new Date(`${y}-12-31`),
        totalFamilies: 1,
        pending: [new Types.ObjectId(ctx.fixtures.familyId)],
      })

      const { POST } = await import('@/lib/route-logic/statements/send-emails/worker')
      expect(
        (await POST(orgJsonReq('/api/statements/send-emails/worker', 'POST', { jobId: 'bad' }))).status,
      ).toBe(400)

      const res = await POST(
        orgJsonReq('/api/statements/send-emails/worker', 'POST', { jobId: job._id.toString() }),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.done).toBe(true)
      expect(body.status).toBe('completed')
    })

    it('fails statement worker when email config is missing', async () => {
      const { EmailConfig } = await import('@/lib/models')
      await EmailConfig.updateOne({ organizationId: ctx.orgId }, { $set: { isActive: false } })

      const { EmailJob } = await import('@/lib/models')
      const job = await EmailJob.create({
        organizationId: ctx.orgId,
        userId: new Types.ObjectId(ctx.userId),
        kind: 'statements',
        status: 'queued',
        fromDate: new Date(),
        toDate: new Date(),
        totalFamilies: 1,
        pending: [new Types.ObjectId(ctx.fixtures.familyId)],
      })

      const { POST } = await import('@/lib/route-logic/statements/send-emails/worker')
      const res = await POST(
        orgJsonReq('/api/statements/send-emails/worker', 'POST', { jobId: job._id.toString() }),
      )
      expect(res.status).toBe(200)
      expect((await res.json()).status).toBe('failed')

      await seedEmailConfig()
    })

    it('processes tax-receipt worker and rejects wrong job kind', async () => {
      await seedEmailConfig()
      const { EmailJob } = await import('@/lib/models')
      const y = year()

      const taxJob = await EmailJob.create({
        organizationId: ctx.orgId,
        userId: new Types.ObjectId(ctx.userId),
        kind: 'tax-receipts',
        status: 'queued',
        year: y,
        totalFamilies: 1,
        pending: [new Types.ObjectId(ctx.fixtures.familyId)],
      })

      const { POST: taxPost } = await import('@/lib/route-logic/tax-receipts/email/worker')
      const taxRes = await taxPost(
        orgJsonReq('/api/tax-receipts/email/worker', 'POST', { jobId: taxJob._id.toString() }),
      )
      expect(taxRes.status).toBe(200)
      expect((await taxRes.json()).done).toBe(true)

      const stmtJob = await EmailJob.create({
        organizationId: ctx.orgId,
        userId: new Types.ObjectId(ctx.userId),
        kind: 'statements',
        status: 'queued',
        totalFamilies: 1,
        pending: [new Types.ObjectId(ctx.fixtures.familyId)],
      })
      const wrongKind = await taxPost(
        orgJsonReq('/api/tax-receipts/email/worker', 'POST', { jobId: stmtJob._id.toString() }),
      )
      expect(wrongKind.status).toBe(400)
    })

    it('accepts cron auth with explicit organizationId', async () => {
      await seedEmailConfig()
      const { EmailJob } = await import('@/lib/models')
      const job = await EmailJob.create({
        organizationId: ctx.orgId,
        userId: new Types.ObjectId(ctx.userId),
        kind: 'tax-receipts',
        status: 'completed',
        year: year(),
        totalFamilies: 0,
        pending: [],
      })

      const { POST } = await import('@/lib/route-logic/tax-receipts/email/worker')
      const res = await POST(
        orgJsonReq('/api/tax-receipts/email/worker', 'POST', {
          jobId: job._id.toString(),
          organizationId: ctx.orgId,
        }, { cron: true }),
      )
      expect(res.status).toBe(200)
      expect((await res.json()).done).toBe(true)
    })
  })

  describe('dues-recommendation', () => {
    it('returns recommendation and validates query params', async () => {
      const { GET } = await import('@/lib/route-logic/dues-recommendation')
      const y = year()

      const ok = await GET(orgJsonReq('/api/dues-recommendation', 'GET'))
      expect(ok.status).toBe(200)
      expect((await ok.json()).multiYear.length).toBeGreaterThan(0)

      const custom = await GET(
        orgJsonReq('/api/dues-recommendation', 'GET', undefined, {
          query: '?windowYears=3&forecastYears=10&startYear=' + y,
        }),
      )
      expect(custom.status).toBe(200)

      expect(
        (await GET(orgJsonReq('/api/dues-recommendation', 'GET', undefined, { query: '?windowYears=99' })))
          .status,
      ).toBe(400)
      expect(
        (await GET(orgJsonReq('/api/dues-recommendation', 'GET', undefined, { query: '?forecastYears=0' })))
          .status,
      ).toBe(400)
      expect(
        (await GET(
          orgJsonReq('/api/dues-recommendation', 'GET', undefined, {
            query: `?startYear=${y - 100}`,
          }),
        )).status,
      ).toBe(400)
    })
  })

  describe('families/[id]/sub-families', () => {
    it('lists sub-families for admin and redacts financial fields for members', async () => {
      const { Family } = await import('@/lib/models')
      const child = await Family.create({
        organizationId: ctx.orgId,
        name: 'Row Sub Family',
        weddingDate: new Date('2018-08-08'),
        parentFamilyId: ctx.fixtures.familyId,
        openBalance: 500,
        paymentPlanId: ctx.fixtures.paymentPlanId,
      })

      const params = { id: ctx.fixtures.familyId }
      const { GET } = await import('@/lib/route-logic/families/[id]/sub-families')

      const adminRes = await GET(
        orgJsonReq(`/api/families/${ctx.fixtures.familyId}/sub-families`, 'GET'),
        { params },
      )
      expect(adminRes.status).toBe(200)
      const adminList = await adminRes.json()
      expect(adminList.some((f: { _id: string }) => String(f._id) === child._id.toString())).toBe(
        true,
      )
      expect(adminList[0].openBalance).toBeDefined()

      mockAuth.mockResolvedValueOnce({
        user: {
          id: ctx.fixtures.memberUserId,
          email: 'member@example.com',
          name: 'API Route Member',
          memberships: [{ o: ctx.orgId, r: 'member' }],
        },
      } as never)

      const memberRes = await GET(
        orgJsonReq(`/api/families/${ctx.fixtures.familyId}/sub-families`, 'GET'),
        { params },
      )
      expect(memberRes.status).toBe(200)
      const memberList = await memberRes.json()
      const row = memberList.find((f: { _id: string }) => String(f._id) === child._id.toString())
      expect(row.openBalance).toBeUndefined()
      bindSession(ctx)

      const badId = await GET(orgJsonReq('/api/families/not-valid/sub-families', 'GET'), {
        params: { id: 'not-valid' },
      })
      expect(badId.status).toBe(400)

      const missing = await GET(
        orgJsonReq(`/api/families/${new Types.ObjectId()}/sub-families`, 'GET'),
        { params: { id: new Types.ObjectId().toString() } },
      )
      expect(missing.status).toBe(404)
    })
  })

  describe('families/[id]/members', () => {
    it('lists members for members without payment plan fields', async () => {
      mockAuth.mockResolvedValueOnce({
        user: {
          id: ctx.fixtures.memberUserId,
          email: 'member@example.com',
          name: 'API Route Member',
          memberships: [{ o: ctx.orgId, r: 'member' }],
        },
      } as never)

      const { GET } = await import('@/lib/route-logic/families/[id]/members')
      const res = await GET(
        orgJsonReq(`/api/families/${ctx.fixtures.familyId}/members`, 'GET'),
        { params: { id: ctx.fixtures.familyId } },
      )
      expect(res.status).toBe(200)
      const list = await res.json()
      expect(list.length).toBeGreaterThan(0)
      expect(list[0].paymentPlanId).toBeUndefined()
      bindSession(ctx)
    })
  })

  describe('organizations/branding/logo', () => {
    const TINY_PNG =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

    it('streams logo bytes and handles missing or malformed logos', async () => {
      const { Organization } = await import('@/lib/models')
      const { GET } = await import('@/lib/route-logic/organizations/branding/logo')

      await Organization.updateOne(
        { _id: ctx.orgId },
        { $set: { 'branding.logoDataUrl': TINY_PNG, 'branding.logoUpdatedAt': new Date() } },
      )

      const ok = await GET(orgJsonReq('/api/organizations/branding/logo', 'GET'))
      expect(ok.status).toBe(200)
      expect(ok.headers.get('content-type')).toContain('image/png')

      await Organization.updateOne({ _id: ctx.orgId }, { $unset: { branding: 1 } })
      expect((await GET(orgJsonReq('/api/organizations/branding/logo', 'GET'))).status).toBe(404)

      await Organization.updateOne(
        { _id: ctx.orgId },
        { $set: { branding: { logoDataUrl: 'not-a-data-url' } } },
      )
      expect((await GET(orgJsonReq('/api/organizations/branding/logo', 'GET'))).status).toBe(500)

      await Organization.updateOne({ _id: ctx.orgId }, { $unset: { branding: 1 } })
    })
  })

  describe('search', () => {
    it('searches families and rejects empty query', async () => {
      const { GET } = await import('@/lib/route-logic/search')

      const res = await GET(
        orgJsonReq('/api/search', 'GET', undefined, { query: '?q=Marker' }),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.items.some((i: { type: string }) => i.type === 'family')).toBe(true)

      const bad = await GET(orgJsonReq('/api/search', 'GET', undefined, { query: '?q=' }))
      expect(bad.status).toBe(400)
    })
  })

  describe('auth/invite (expanded)', () => {
    it('rejects duplicate member invite and owner invite from admin', async () => {
      const { User, OrgMembership } = await import('@/lib/models')
      const existing = await User.findOne({ email: ctx.email }).lean<{ _id: Types.ObjectId }>()
      expect(existing).toBeTruthy()

      const { POST } = await import('@/lib/route-logic/auth/invite')
      const dup = await POST(
        orgJsonReq('/api/auth/invite', 'POST', { email: ctx.email, role: 'member' }),
      )
      expect(dup.status).toBe(409)

      const bcrypt = await import('bcryptjs')
      const adminUser = await User.create({
        email: `row-invite-admin-${Date.now()}@example.com`,
        hashedPassword: await bcrypt.hash('ApiRouteTestPass123!', 10),
        name: 'Invite Admin',
      })
      await OrgMembership.create({
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

      const ownerInvite = await POST(
        orgJsonReq('/api/auth/invite', 'POST', {
          email: `row-owner-invite-${Date.now()}@example.com`,
          role: 'owner',
        }),
      )
      expect(ownerInvite.status).toBe(403)
      bindSession(ctx)
    })
  })

  describe('user/password', () => {
    it('rejects wrong and identical passwords then accepts a change', async () => {
      const { PATCH } = await import('@/lib/route-logic/user/password')
      const bad = await PATCH(
        orgJsonReq('/api/user/password', 'PATCH', {
          currentPassword: 'wrong',
          newPassword: 'ApiRouteTestPass123!',
        }),
      )
      expect(bad.status).toBe(401)

      const same = await PATCH(
        orgJsonReq('/api/user/password', 'PATCH', {
          currentPassword: 'ApiRouteTestPass123!',
          newPassword: 'ApiRouteTestPass123!',
        }),
      )
      expect(same.status).toBe(400)

      const ok = await PATCH(
        orgJsonReq('/api/user/password', 'PATCH', {
          currentPassword: 'ApiRouteTestPass123!',
          newPassword: 'RowCoveragePass123!',
        }),
      )
      expect(ok.status).toBe(200)

      await PATCH(
        orgJsonReq('/api/user/password', 'PATCH', {
          currentPassword: 'RowCoveragePass123!',
          newPassword: 'ApiRouteTestPass123!',
        }),
      )
    })
  })
})


