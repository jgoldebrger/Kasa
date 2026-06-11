/**
 * Stripe route-logic branch/statement coverage (webhook, confirm-payment, create-payment-intent).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
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

function orgJsonReq(path: string, method: string, body?: unknown): NextRequest {
  const headers: Record<string, string> = {
    host: 'localhost:3000',
    origin: API_ORIGIN,
    'x-organization-id': ctx.orgId,
  }
  if (body !== undefined) headers['content-type'] = 'application/json'
  return new NextRequest(`${API_ORIGIN}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

function webhookReq(event: { id: string; type: string; data: unknown }): NextRequest {
  return new NextRequest(`${API_ORIGIN}/api/stripe/webhook`, {
    method: 'POST',
    headers: { 'stripe-signature': 't=0,v1=x', 'content-type': 'application/json' },
    body: JSON.stringify(event),
  })
}

async function stripeTestClient() {
  const Stripe = (await import('stripe')).default
  return new Stripe('sk_test') as unknown as {
    webhooks: { constructEvent: ReturnType<typeof vi.fn> }
    paymentIntents: {
      retrieve: ReturnType<typeof vi.fn>
      create: ReturnType<typeof vi.fn>
    }
    paymentMethods: { retrieve: ReturnType<typeof vi.fn> }
    charges: { retrieve: ReturnType<typeof vi.fn> }
  }
}

describe.sequential('stripe route-logic coverage', () => {
  const year = () => new Date().getFullYear()

  beforeAll(async () => {
    process.env.CRON_SECRET = process.env.CRON_SECRET || 'test-cron-secret'
    process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test'
    process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test'
    ctx = await seedApiRouteFixtures()
    process.env.KASA_TEST_STRIPE_ORG = ctx.orgId
    process.env.KASA_TEST_STRIPE_FAMILY = ctx.fixtures.familyId
    bindSession(ctx)
  })

  afterAll(async () => {
    await teardownApiRouteFixtures()
    vi.restoreAllMocks()
  })

  afterEach(async () => {
    const { Task, Payment, StripeWebhookEvent } = await import('@/lib/models')
    await Task.deleteMany({ organizationId: ctx.orgId })
    await StripeWebhookEvent.deleteMany({})
    await Payment.deleteMany({ organizationId: ctx.orgId, notes: /stripe-cov-/ })
  })

  describe('webhook.ts', () => {
    it('returns 503 when Stripe secrets are missing', async () => {
      const prevKey = process.env.STRIPE_SECRET_KEY
      const prevWh = process.env.STRIPE_WEBHOOK_SECRET
      delete process.env.STRIPE_SECRET_KEY
      delete process.env.STRIPE_WEBHOOK_SECRET
      vi.resetModules()
      const { POST } = await import('@/lib/route-logic/stripe/webhook')
      const res = await POST(
        webhookReq({ id: `evt_503_${Date.now()}`, type: 'ping', data: {} }),
      )
      expect(res.status).toBe(503)
      process.env.STRIPE_SECRET_KEY = prevKey ?? 'sk_test'
      process.env.STRIPE_WEBHOOK_SECRET = prevWh ?? 'whsec_test'
      vi.resetModules()
    })

    it('no-ops charge.refunded when payment_intent is missing or payment row absent', async () => {
      const { POST } = await import('@/lib/route-logic/stripe/webhook')

      expect(
        (
          await POST(
            webhookReq({
              id: `evt_ref_no_pi_${Date.now()}`,
              type: 'charge.refunded',
              data: { object: { id: 'ch_no_pi', amount_refunded: 500, currency: 'usd' } },
            }),
          )
        ).status,
      ).toBe(200)

      const piObj = `pi_obj${Date.now()}`
      expect(
        (
          await POST(
            webhookReq({
              id: `evt_ref_obj_pi_${Date.now()}`,
              type: 'charge.refunded',
              data: {
                object: {
                  id: 'ch_obj_pi',
                  payment_intent: { id: piObj },
                  amount_refunded: 0,
                  currency: 'usd',
                },
              },
            }),
          )
        ).status,
      ).toBe(200)
    })

    it('opens dispute task with evidence deadline and skips duplicate dispute tasks', async () => {
      const piId = `pi_disputecov${Date.now()}`
      const disputeId = `dp_cov_${Date.now()}`
      const { Payment, Task } = await import('@/lib/models')
      await Payment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        amount: 120,
        paymentDate: new Date(),
        year: year(),
        type: 'membership',
        paymentMethod: 'credit_card',
        stripePaymentIntentId: piId,
      })

      const client = await stripeTestClient()
      const dueBy = Math.floor(Date.now() / 1000) + 86400 * 7
      client.charges.retrieve.mockResolvedValue({
        id: 'ch_dispute_cov',
        payment_intent: piId,
        amount_refunded: 0,
        currency: 'usd',
      })

      const openEvent = {
        id: `evt_dp_open_${Date.now()}`,
        type: 'charge.dispute.created',
        data: {
          object: {
            id: disputeId,
            charge: { id: 'ch_dispute_cov' },
            status: 'needs_response',
            reason: 'fraudulent',
            evidence_details: { due_by: dueBy },
            payment_intent: piId,
          },
        },
      }

      const { POST } = await import('@/lib/route-logic/stripe/webhook')
      const first = await POST(webhookReq(openEvent))
      expect(first.status).toBe(200)
      const tasksAfterFirst = await Task.countDocuments({
        organizationId: ctx.orgId,
        notes: { $regex: disputeId },
      })
      expect(tasksAfterFirst).toBe(1)

      await POST(
        webhookReq({
          id: `evt_dp_dup_${Date.now()}`,
          type: 'charge.dispute.created',
          data: {
            object: {
              id: disputeId,
              charge: { id: 'ch_dispute_cov' },
              status: 'needs_response',
              reason: 'fraudulent',
              payment_intent: piId,
            },
          },
        }),
      )
      const tasksAfterSecond = await Task.countDocuments({
        organizationId: ctx.orgId,
        notes: { $regex: disputeId },
      })
      expect(tasksAfterSecond).toBe(1)

      await Payment.deleteMany({ stripePaymentIntentId: piId })
    })

    it('tracks disputes when the linked family row is missing', async () => {
      const piId = `pi_nofam${Date.now()}`
      const missingFamilyId = new Types.ObjectId()
      const { Payment } = await import('@/lib/models')
      await Payment.create({
        organizationId: ctx.orgId,
        familyId: missingFamilyId,
        amount: 55,
        paymentDate: new Date(),
        year: year(),
        type: 'membership',
        paymentMethod: 'credit_card',
        stripePaymentIntentId: piId,
      })

      const client = await stripeTestClient()
      client.charges.retrieve.mockResolvedValueOnce({
        id: 'ch_nofam',
        payment_intent: piId,
        amount_refunded: 0,
        currency: 'usd',
      })

      const { POST } = await import('@/lib/route-logic/stripe/webhook')
      expect(
        (
          await POST(
            webhookReq({
              id: `evt_dp_nofam_${Date.now()}`,
              type: 'charge.dispute.created',
              data: {
                object: {
                  id: `dp_nofam_${Date.now()}`,
                  charge: 'ch_nofam',
                  status: 'needs_response',
                  payment_intent: piId,
                },
              },
            }),
          )
        ).status,
      ).toBe(200)
      const row = await Payment.findOne({ stripePaymentIntentId: piId })
      expect(row?.disputedAt).toBeTruthy()
      await Payment.deleteMany({ stripePaymentIntentId: piId })
    })

    it('creates admin task on payment_intent.payment_failed when none exists', async () => {
      const piId = `pi_failedcov${Date.now()}`
      const { Task } = await import('@/lib/models')
      await Task.deleteMany({ organizationId: ctx.orgId, relatedFamilyId: ctx.fixtures.familyId })

      const { POST } = await import('@/lib/route-logic/stripe/webhook')
      expect(
        (
          await POST(
            webhookReq({
              id: `evt_pi_fail_${Date.now()}`,
              type: 'payment_intent.payment_failed',
              data: {
                object: {
                  id: piId,
                  amount: 3300,
                  currency: 'usd',
                  metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
                  last_payment_error: { message: 'insufficient_funds' },
                },
              },
            }),
          )
        ).status,
      ).toBe(200)

      const task = await Task.findOne({
        organizationId: ctx.orgId,
        relatedFamilyId: ctx.fixtures.familyId,
        notes: { $regex: piId },
      })
      expect(task).toBeTruthy()
      expect(task?.title).toMatch(/failed/i)
    })

    it('skips payment_intent handlers when metadata or family is missing', async () => {
      const { POST } = await import('@/lib/route-logic/stripe/webhook')

      for (const type of ['payment_intent.succeeded', 'payment_intent.canceled', 'payment_intent.payment_failed'] as const) {
        expect(
          (
            await POST(
              webhookReq({
                id: `evt_${type}_nometa_${Date.now()}`,
                type,
                data: { object: { id: `pi_nometatype${type.length}`, amount: 100, currency: 'usd' } },
              }),
            )
          ).status,
        ).toBe(200)
      }

      const bogusFamily = new Types.ObjectId().toString()
      expect(
        (
          await POST(
            webhookReq({
              id: `evt_pi_succ_nofam_${Date.now()}`,
              type: 'payment_intent.succeeded',
              data: {
                object: {
                  id: `pi_succnofam${Date.now()}`,
                  amount: 2000,
                  currency: 'usd',
                  created: Math.floor(Date.now() / 1000),
                  metadata: { organizationId: ctx.orgId, familyId: bogusFamily },
                },
              },
            }),
          )
        ).status,
      ).toBe(200)
    })

    it('clears dedup record when handler throws (including deleteOne catch)', async () => {
      const { Payment, StripeWebhookEvent } = await import('@/lib/models')
      const piId = `pi_handlererr${Date.now()}`
      await Payment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        amount: 40,
        paymentDate: new Date(),
        year: year(),
        type: 'membership',
        paymentMethod: 'credit_card',
        stripePaymentIntentId: piId,
      })

      const findSpy = vi.spyOn(Payment, 'findOne').mockImplementation(async (...args: unknown[]) => {
        const opts = args[2] as { includeDeleted?: boolean } | undefined
        if (opts?.includeDeleted) {
          throw new Error('db blip')
        }
        return (Payment.findOne as typeof Payment.findOne).bind(Payment)(...(args as Parameters<typeof Payment.findOne>))
      })
      const deleteSpy = vi
        .spyOn(StripeWebhookEvent, 'deleteOne')
        .mockRejectedValueOnce(new Error('delete failed'))

      try {
        const { POST } = await import('@/lib/route-logic/stripe/webhook')
        const res = await POST(
          webhookReq({
            id: `evt_handler_err_${Date.now()}`,
            type: 'charge.refunded',
            data: {
              object: {
                id: 'ch_handler_err',
                payment_intent: piId,
                amount_refunded: 1000,
                currency: 'usd',
              },
            },
          }),
        )
        expect(res.status).toBe(500)
        expect(deleteSpy).toHaveBeenCalled()
      } finally {
        findSpy.mockRestore()
        deleteSpy.mockRestore()
      }
    })

    it('backstops payment_intent.succeeded when org timezone lookup fails', async () => {
      const piId = `pi_tzfail${Date.now()}`
      const { Payment, Organization } = await import('@/lib/models')
      await Payment.deleteMany({ stripePaymentIntentId: piId })
      const orgSpy = vi.spyOn(Organization, 'findById').mockReturnValueOnce({
        select: () => ({
          lean: () => Promise.reject(new Error('org tz lookup failed')),
        }),
      } as never)

      try {
        const { POST } = await import('@/lib/route-logic/stripe/webhook')
        expect(
          (
            await POST(
              webhookReq({
                id: `evt_pi_tz_${Date.now()}`,
                type: 'payment_intent.succeeded',
                data: {
                  object: {
                    id: piId,
                    amount: 2500,
                    currency: 'usd',
                    created: Math.floor(Date.now() / 1000),
                    metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
                  },
                },
              }),
            )
          ).status,
        ).toBe(200)
        expect(await Payment.findOne({ stripePaymentIntentId: piId })).toBeTruthy()
      } finally {
        orgSpy.mockRestore()
        await Payment.deleteMany({ stripePaymentIntentId: piId })
      }
    })
  })

  describe('create-payment-intent.ts', () => {
    it('rejects over-max amounts and rate limits', async () => {
      bindSession(ctx)
      const { POST } = await import('@/lib/route-logic/stripe/create-payment-intent')
      const over = await POST(
        orgJsonReq('/api/stripe/create-payment-intent', 'POST', {
          familyId: ctx.fixtures.familyId,
          amount: 100_001,
        }),
      )
      expect(over.status).toBe(400)

      const rateLimit = await import('@/lib/rate-limit')
      const spy = vi.spyOn(rateLimit, 'checkRateLimit').mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      })
      const limited = await POST(
        orgJsonReq('/api/stripe/create-payment-intent', 'POST', {
          familyId: ctx.fixtures.familyId,
          amount: 10,
        }),
      )
      expect(limited.status).toBe(429)
      spy.mockRestore()
    })

    it('creates PI without active recurring (ratioVsRecurring stays null)', async () => {
      bindSession(ctx)
      const { RecurringPayment } = await import('@/lib/models')
      await RecurringPayment.deleteMany({ organizationId: ctx.orgId, familyId: ctx.fixtures.familyId })
      const { POST } = await import('@/lib/route-logic/stripe/create-payment-intent')
      const res = await POST(
        orgJsonReq('/api/stripe/create-payment-intent', 'POST', {
          familyId: ctx.fixtures.familyId,
          amount: 17,
          idempotencyHint: `no-rec-${Date.now()}`,
        }),
      )
      expect(res.status).toBe(200)
    })
  })

  describe('confirm-payment.ts', () => {
    it('rejects cross-org PI reuse and metadata mismatches', async () => {
      bindSession(ctx)
      const { POST } = await import('@/lib/route-logic/stripe/confirm-payment')
      const { Payment } = await import('@/lib/models')

      const piId = `pi_crossorg${Date.now()}`
      await Payment.create({
        organizationId: ctx.betaOrgId,
        familyId: ctx.fixtures.betaFamilyId,
        amount: 30,
        paymentDate: new Date(),
        year: year(),
        type: 'membership',
        paymentMethod: 'credit_card',
        stripePaymentIntentId: piId,
      })
      expect(
        (
          await POST(
            orgJsonReq('/api/stripe/confirm-payment', 'POST', {
              paymentIntentId: piId,
              familyId: ctx.fixtures.familyId,
            }),
          )
        ).status,
      ).toBe(409)
      await Payment.deleteMany({ stripePaymentIntentId: piId })

      const client = await stripeTestClient()
      vi.mocked(client.paymentIntents.retrieve).mockReset()
      const piOrg = `pi_orgmis${Date.now()}`
      vi.mocked(client.paymentIntents.retrieve).mockResolvedValueOnce({
        id: piOrg,
        status: 'succeeded',
        amount: 2000,
        currency: 'usd',
        metadata: { organizationId: ctx.betaOrgId, familyId: ctx.fixtures.familyId },
      })
      expect(
        (
          await POST(
            orgJsonReq('/api/stripe/confirm-payment', 'POST', {
              paymentIntentId: piOrg,
              familyId: ctx.fixtures.familyId,
            }),
          )
        ).status,
      ).toBe(403)

      vi.mocked(client.paymentIntents.retrieve).mockReset()
      const piFam = `pi_fammis${Date.now()}`
      vi.mocked(client.paymentIntents.retrieve).mockResolvedValueOnce({
        id: piFam,
        status: 'succeeded',
        amount: 2000,
        currency: 'usd',
        metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.betaFamilyId },
      })
      expect(
        (
          await POST(
            orgJsonReq('/api/stripe/confirm-payment', 'POST', {
              paymentIntentId: piFam,
              familyId: ctx.fixtures.familyId,
            }),
          )
        ).status,
      ).toBe(403)
    })

    it('declines non-succeeded PI and sets up monthly recurring on confirm', async () => {
      bindSession(ctx)
      const client = await stripeTestClient()
      vi.mocked(client.paymentIntents.retrieve).mockReset()
      vi.mocked(client.paymentMethods.retrieve).mockReset()
      const piBad = `pi_notsucc${Date.now()}`
      vi.mocked(client.paymentIntents.retrieve).mockResolvedValueOnce({
        id: piBad,
        status: 'requires_payment_method',
        amount: 1500,
        currency: 'usd',
        metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
      })

      const { POST } = await import('@/lib/route-logic/stripe/confirm-payment')
      const declined = await POST(
        orgJsonReq('/api/stripe/confirm-payment', 'POST', {
          paymentIntentId: piBad,
          familyId: ctx.fixtures.familyId,
        }),
      )
      expect(declined.status).toBe(400)

      const piMonthly = `pi_monthly${Date.now()}`
      const { Payment, RecurringPayment, SavedPaymentMethod } = await import('@/lib/models')
      await Payment.deleteMany({ stripePaymentIntentId: piMonthly })
      await RecurringPayment.deleteMany({ organizationId: ctx.orgId, familyId: ctx.fixtures.familyId })

      vi.mocked(client.paymentIntents.retrieve).mockResolvedValueOnce({
        id: piMonthly,
        status: 'succeeded',
        amount: 4500,
        currency: 'usd',
        payment_method: 'pm_probemock',
        metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
      })
      vi.mocked(client.paymentMethods.retrieve).mockResolvedValueOnce({
        id: 'pm_probemock',
        card: { last4: '4242', brand: 'visa', exp_month: 6, exp_year: 2031 },
        billing_details: { name: 'Monthly User' },
      })

      const monthly = await POST(
        orgJsonReq('/api/stripe/confirm-payment', 'POST', {
          paymentIntentId: piMonthly,
          familyId: ctx.fixtures.familyId,
          paymentFrequency: 'monthly',
          savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
          paymentDate: '2024-06-15',
          year: 2024,
        }),
      )
      expect(monthly.status).toBe(200)
      const body = await monthly.json()
      expect(body.recurringPaymentId).toBeTruthy()

      const existingRec = await RecurringPayment.findOne({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
        isActive: true,
      })
      expect(existingRec).toBeTruthy()

      const piMonthly2 = `pi_monthly2${Date.now()}`
      await Payment.deleteMany({ stripePaymentIntentId: piMonthly2 })
      vi.mocked(client.paymentIntents.retrieve).mockResolvedValueOnce({
        id: piMonthly2,
        status: 'succeeded',
        amount: 5000,
        currency: 'usd',
        payment_method: 'pm_probemock',
        metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
      })
      const updateRec = await POST(
        orgJsonReq('/api/stripe/confirm-payment', 'POST', {
          paymentIntentId: piMonthly2,
          familyId: ctx.fixtures.familyId,
          paymentFrequency: 'monthly',
          savedPaymentMethodId: ctx.fixtures.savedPaymentMethodId,
        }),
      )
      expect(updateRec.status).toBe(200)
      await Payment.deleteMany({ stripePaymentIntentId: { $in: [piMonthly, piMonthly2] } })
      await RecurringPayment.deleteMany({ organizationId: ctx.orgId, familyId: ctx.fixtures.familyId })
      await SavedPaymentMethod.updateMany(
        { _id: ctx.fixtures.savedPaymentMethodId },
        { $set: { isActive: true } },
      )
    })

    it('returns deduplicated existing payment and validates memberId', async () => {
      bindSession(ctx)
      const client = await stripeTestClient()
      vi.mocked(client.paymentIntents.retrieve).mockReset()
      const piId = `pi_dedup${Date.now()}`
      const { Payment } = await import('@/lib/models')
      await Payment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        amount: 22,
        paymentDate: new Date(),
        year: year(),
        type: 'membership',
        paymentMethod: 'credit_card',
        stripePaymentIntentId: piId,
      })

      vi.mocked(client.paymentIntents.retrieve).mockResolvedValueOnce({
        id: piId,
        status: 'succeeded',
        amount: 2200,
        currency: 'usd',
        metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
      })

      const { POST } = await import('@/lib/route-logic/stripe/confirm-payment')
      const dup = await POST(
        orgJsonReq('/api/stripe/confirm-payment', 'POST', {
          paymentIntentId: piId,
          familyId: ctx.fixtures.familyId,
        }),
      )
      expect(dup.status).toBe(200)
      expect((await dup.json()).deduplicated).toBe(true)

      const withMember = `pi_member${Date.now()}`
      await Payment.deleteMany({ stripePaymentIntentId: withMember })
      vi.mocked(client.paymentIntents.retrieve).mockResolvedValueOnce({
        id: withMember,
        status: 'succeeded',
        amount: 1800,
        currency: 'usd',
        metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
      })
      const okMember = await POST(
        orgJsonReq('/api/stripe/confirm-payment', 'POST', {
          paymentIntentId: withMember,
          familyId: ctx.fixtures.familyId,
          memberId: ctx.fixtures.memberId,
        }),
      )
      expect(okMember.status).toBe(200)
      await Payment.deleteMany({ stripePaymentIntentId: { $in: [piId, withMember] } })
    })
  })
})
