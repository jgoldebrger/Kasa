/**
 * Recurring-payments process route-logic branch coverage.
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

async function stripeTestClient() {
  const Stripe = (await import('stripe')).default
  return new Stripe('sk_test') as unknown as {
    paymentIntents: { create: ReturnType<typeof vi.fn> }
  }
}

describe.sequential('recurring-payments process coverage', () => {
  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test'
    ctx = await seedApiRouteFixtures()
    bindSession(ctx)
  })

  afterAll(async () => {
    await teardownApiRouteFixtures()
    vi.restoreAllMocks()
  })

  it('POST fails for deleted family and missing saved payment method', async () => {
    bindSession(ctx)
    const due = new Date()
    due.setDate(due.getDate() - 1)
    const { RecurringPayment, Family, SavedPaymentMethod } = await import('@/lib/models')

    await RecurringPayment.deleteMany({ organizationId: ctx.orgId })
    await RecurringPayment.create({
      organizationId: ctx.orgId,
      familyId: ctx.fixtures.betaFamilyId,
      savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
      amount: 14,
      frequency: 'monthly',
      startDate: due,
      nextPaymentDate: due,
      isActive: true,
    })
    await Family.updateOne({ _id: ctx.fixtures.betaFamilyId }, { $set: { deletedAt: new Date() } })

    const { POST } = await import('@/lib/route-logic/recurring-payments/process')
    const deletedFam = await POST(orgJsonReq('/api/recurring-payments/process', 'POST', {}))
    expect(deletedFam.status).toBe(200)
    expect((await deletedFam.json()).failed).toBeGreaterThanOrEqual(1)
    await Family.updateOne({ _id: ctx.fixtures.betaFamilyId }, { $unset: { deletedAt: 1 } })

    await RecurringPayment.deleteMany({ organizationId: ctx.orgId })
    const inactiveSpm = await SavedPaymentMethod.create({
      organizationId: ctx.orgId,
      familyId: ctx.fixtures.familyId,
      stripePaymentMethodId: `pm_inactive_${Date.now()}`,
      last4: '0000',
      cardType: 'visa',
      expiryMonth: 1,
      expiryYear: 2030,
      isDefault: false,
      isActive: false,
    })
    await RecurringPayment.create({
      organizationId: ctx.orgId,
      familyId: ctx.fixtures.familyId,
      savedPaymentMethodId: inactiveSpm._id,
      amount: 15,
      frequency: 'monthly',
      startDate: due,
      nextPaymentDate: due,
      isActive: true,
    })
    const noSpm = await POST(orgJsonReq('/api/recurring-payments/process', 'POST', {}))
    expect(noSpm.status).toBe(200)
    expect((await noSpm.json()).failed).toBeGreaterThanOrEqual(1)
    await RecurringPayment.deleteMany({ organizationId: ctx.orgId })
    await SavedPaymentMethod.deleteOne({ _id: inactiveSpm._id })
  })

  it('POST rolls back claim when Stripe charge fails and opens declined task', async () => {
    bindSession(ctx)
    const due = new Date()
    due.setDate(due.getDate() - 1)
    const { RecurringPayment, Task } = await import('@/lib/models')
    await RecurringPayment.deleteMany({ organizationId: ctx.orgId })
    const rec = await RecurringPayment.create({
      organizationId: ctx.orgId,
      familyId: ctx.fixtures.familyId,
      savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
      amount: 16,
      frequency: 'monthly',
      startDate: due,
      nextPaymentDate: due,
      isActive: true,
    })
    const claimedDate = rec.nextPaymentDate

    const client = await stripeTestClient()
    vi.mocked(client.paymentIntents.create).mockRejectedValueOnce(new Error('card_declined'))

    const { POST } = await import('@/lib/route-logic/recurring-payments/process')
    const res = await POST(orgJsonReq('/api/recurring-payments/process', 'POST', {}))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.failed).toBeGreaterThanOrEqual(1)

    const refreshed = await RecurringPayment.findById(rec._id)
    expect(refreshed?.nextPaymentDate?.getTime()).toBe(claimedDate?.getTime())

    const task = await Task.findOne({
      organizationId: ctx.orgId,
      relatedFamilyId: ctx.fixtures.familyId,
    }).sort({ createdAt: -1 })
    expect(task?.title).toMatch(/failed|declined/i)
    await RecurringPayment.deleteOne({ _id: rec._id })
  })

  it('POST handles non-succeeded PI and ledger write failure after charge', async () => {
    bindSession(ctx)
    const due = new Date()
    due.setDate(due.getDate() - 1)
    const { RecurringPayment, Payment } = await import('@/lib/models')

    await RecurringPayment.deleteMany({ organizationId: ctx.orgId })
    const recStatus = await RecurringPayment.create({
      organizationId: ctx.orgId,
      familyId: ctx.fixtures.familyId,
      savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
      amount: 18,
      frequency: 'monthly',
      startDate: due,
      nextPaymentDate: due,
      isActive: true,
    })

    const client = await stripeTestClient()
    vi.mocked(client.paymentIntents.create).mockResolvedValueOnce({
      id: `pi_reqaction${Date.now()}`,
      status: 'requires_action',
      amount: 1800,
      currency: 'usd',
      payment_method: 'pm_probemock',
    })

    const { POST } = await import('@/lib/route-logic/recurring-payments/process')
    const notSucceeded = await POST(orgJsonReq('/api/recurring-payments/process', 'POST', {}))
    expect(notSucceeded.status).toBe(200)
    expect((await notSucceeded.json()).failed).toBeGreaterThanOrEqual(1)
    await RecurringPayment.deleteOne({ _id: recStatus._id })

    await RecurringPayment.create({
      organizationId: ctx.orgId,
      familyId: ctx.fixtures.familyId,
      savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
      amount: 20,
      frequency: 'monthly',
      startDate: due,
      nextPaymentDate: due,
      isActive: true,
    })
    const piId = `pi_ledgerfail${Date.now()}`
    vi.mocked(client.paymentIntents.create).mockResolvedValueOnce({
      id: piId,
      status: 'succeeded',
      amount: 2000,
      currency: 'usd',
      payment_method: 'pm_probemock',
    })
    const createSpy = vi
      .spyOn(Payment, 'create')
      .mockRejectedValueOnce(Object.assign(new Error('validation failed'), { code: undefined }))
    const ledgerFail = await POST(orgJsonReq('/api/recurring-payments/process', 'POST', {}))
    expect(ledgerFail.status).toBe(200)
    const ledgerBody = await ledgerFail.json()
    expect(ledgerBody.failed).toBeGreaterThanOrEqual(1)
    expect(ledgerBody.results?.[0]?.error).toMatch(/ledger write failed/i)
    createSpy.mockRestore()
    await RecurringPayment.deleteMany({ organizationId: ctx.orgId })
    await Payment.deleteMany({ stripePaymentIntentId: piId })
  })

  it('GET validates familyId and rate limits list', async () => {
    bindSession(ctx)
    const { GET } = await import('@/lib/route-logic/recurring-payments/process')

    const badId = await GET(
      orgJsonReq('/api/recurring-payments/process', 'GET', undefined, { query: '?familyId=bad' }),
    )
    expect(badId.status).toBe(400)

    const missing = await GET(
      orgJsonReq('/api/recurring-payments/process', 'GET', undefined, {
        query: `?familyId=${new Types.ObjectId()}`,
      }),
    )
    expect(missing.status).toBe(404)

    const rateLimit = await import('@/lib/rate-limit')
    const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValueOnce({
      allowed: false,
        remaining: 0,
        resetAt: 0,
    })
    const limited = await GET(orgJsonReq('/api/recurring-payments/process', 'GET'))
    expect(limited.status).toBe(429)
    spy.mockRestore()
  })

  it('POST returns no-due message when nothing to process', async () => {
    bindSession(ctx)
    const future = new Date()
    future.setMonth(future.getMonth() + 3)
    const { RecurringPayment } = await import('@/lib/models')
    await RecurringPayment.updateMany(
      { organizationId: ctx.orgId },
      { $set: { nextPaymentDate: future, isActive: true } },
    )

    const { POST } = await import('@/lib/route-logic/recurring-payments/process')
    const res = await POST(orgJsonReq('/api/recurring-payments/process', 'POST', {}))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toMatch(/no recurring payments due/i)
    expect(body.processed).toBe(0)
  })

  it('POST rate limits processing', async () => {
    bindSession(ctx)
    const rateLimit = await import('@/lib/rate-limit')
    const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValueOnce({
      allowed: false,
        remaining: 0,
        resetAt: 0,
    })
    const { POST } = await import('@/lib/route-logic/recurring-payments/process')
    const res = await POST(orgJsonReq('/api/recurring-payments/process', 'POST', {}))
    expect(res.status).toBe(429)
    spy.mockRestore()
  })
})
