import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'

const stripeMocks = vi.hoisted(() => {
  const constructEvent = vi.fn((rawBody: string | Buffer) => {
    const text = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')
    return JSON.parse(text)
  })
  const charges = {
    retrieve: vi.fn(async () => ({
      id: 'ch_probe',
      payment_intent: 'pi_apiprobemock',
      amount_refunded: 2500,
      currency: 'usd',
    })),
  }
  return { constructEvent, charges }
})

vi.mock('stripe', () => ({
  default: vi.fn(function Stripe() {
    return {
      webhooks: { constructEvent: stripeMocks.constructEvent },
      charges: stripeMocks.charges,
      paymentIntents: { create: vi.fn(), retrieve: vi.fn() },
    }
  }),
}))

import { NextRequest } from 'next/server'
import { Types } from 'mongoose'
import { setupMongo, teardownMongo } from './test/mongo-memory'

const PI = 'pi_apiprobemock'

describe('stripe-webhook POST (integration)', () => {
  const orgId = new Types.ObjectId()
  const familyId = new Types.ObjectId()

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_webhook'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
    await setupMongo()
  })

  afterAll(async () => {
    await teardownMongo()
  })

  afterEach(async () => {
    const { Payment, StripeWebhookEvent, Organization, Family, Task } = await import('./models')
    await Promise.all([
      StripeWebhookEvent.deleteMany({}),
      Task.deleteMany({ organizationId: orgId }),
      Payment.deleteMany({}),
      Family.deleteMany({}),
      Organization.deleteMany({}),
    ])
  })

  async function seedPayment(extra: Record<string, unknown> = {}) {
    const { Organization, Family, Payment } = await import('./models')
    await Organization.create({
      _id: orgId,
      name: 'Webhook Org',
      slug: `wh-${orgId.toString().slice(-6)}`,
      ownerId: new Types.ObjectId(),
      timezone: 'UTC',
      currency: 'USD',
    })
    await Family.create({
      _id: familyId,
      organizationId: orgId,
      name: 'Webhook Family',
      weddingDate: new Date('2015-01-01'),
      email: 'webhook-family@example.com',
    })
    await Payment.create({
      organizationId: orgId,
      familyId,
      amount: 100,
      paymentDate: new Date(),
      year: 2024,
      type: 'membership',
      paymentMethod: 'credit_card',
      stripePaymentIntentId: PI,
      ...extra,
    })
  }

  function webhookRequest(body: object): NextRequest {
    return new NextRequest('http://localhost:3000/api/stripe/webhook', {
      method: 'POST',
      headers: {
        'stripe-signature': 't=0,v1=test',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  }

  it('returns 400 without stripe-signature', async () => {
    const { POST } = await import('./route-logic/stripe/webhook')
    const res = await POST(
      new NextRequest('http://localhost:3000/api/stripe/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'evt_nosig', type: 'ping' }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it('acks unknown event types', async () => {
    const { POST } = await import('./route-logic/stripe/webhook')
    const res = await POST(
      webhookRequest({
        id: `evt_unknown_${Date.now()}`,
        type: 'customer.created',
        data: { object: { id: 'cus_x' } },
      }),
    )
    expect(res.status).toBe(200)
  })

  it('deduplicates duplicate event ids', async () => {
    await seedPayment()
    const { POST } = await import('./route-logic/stripe/webhook')
    const payload = {
      id: `evt_dup_${Date.now()}`,
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_1',
          payment_intent: PI,
          amount_refunded: 1000,
          currency: 'usd',
        },
      },
    }
    const first = await POST(webhookRequest(payload))
    const second = await POST(webhookRequest(payload))
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    const body = await second.json()
    expect(body.deduplicated).toBe(true)
  })

  it('updates payment on charge.refunded', async () => {
    await seedPayment()
    const { POST } = await import('./route-logic/stripe/webhook')
    const res = await POST(
      webhookRequest({
        id: `evt_ref_${Date.now()}`,
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_1',
            payment_intent: PI,
            amount_refunded: 5000,
            currency: 'usd',
          },
        },
      }),
    )
    expect(res.status).toBe(200)
    const { Payment } = await import('./models')
    const row = await Payment.findOne({ stripePaymentIntentId: PI })
    expect(Number(row?.refundedAmount || 0)).toBeGreaterThan(0)
  })

  it('handles charge.dispute.created and closed', async () => {
    await seedPayment()
    const { POST } = await import('./route-logic/stripe/webhook')
    const created = await POST(
      webhookRequest({
        id: `evt_dp_c_${Date.now()}`,
        type: 'charge.dispute.created',
        data: {
          object: {
            id: 'dp_probe',
            charge: 'ch_probe',
            status: 'needs_response',
            payment_intent: PI,
          },
        },
      }),
    )
    expect(created.status).toBe(200)
    const { Payment, Task } = await import('./models')
    const pay = await Payment.findOne({ stripePaymentIntentId: PI })
    expect(pay?.disputedAt).toBeTruthy()

    const closed = await POST(
      webhookRequest({
        id: `evt_dp_x_${Date.now()}`,
        type: 'charge.dispute.closed',
        data: {
          object: {
            id: 'dp_probe',
            charge: 'ch_probe',
            status: 'won',
            payment_intent: PI,
          },
        },
      }),
    )
    expect(closed.status).toBe(200)
    const tasks = await Task.countDocuments({ organizationId: orgId })
    expect(tasks).toBeGreaterThanOrEqual(1)
  })

  it('handles payment_intent.succeeded, failed, and canceled', async () => {
    await seedPayment()
    const { POST } = await import('./route-logic/stripe/webhook')
    for (const type of [
      'payment_intent.succeeded',
      'payment_intent.payment_failed',
      'payment_intent.canceled',
    ] as const) {
      const res = await POST(
        webhookRequest({
          id: `evt_${type}_${Date.now()}`,
          type,
          data: {
            object: {
              id: PI,
              metadata: { organizationId: orgId.toString(), familyId: familyId.toString() },
              last_payment_error: type === 'payment_intent.payment_failed' ? { message: 'card_declined' } : undefined,
            },
          },
        }),
      )
      expect(res.status).toBe(200)
    }
  })

  it('is idempotent when charge.refunded amount does not increase', async () => {
    await seedPayment({ refundedAmount: 50, refundedAt: new Date() })
    const { POST } = await import('./route-logic/stripe/webhook')
    const payload = {
      id: `evt_ref_idem_${Date.now()}`,
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_1',
          payment_intent: PI,
          amount_refunded: 5000,
          currency: 'usd',
        },
      },
    }
    await POST(webhookRequest(payload))
    const { Payment } = await import('./models')
    const before = await Payment.findOne({ stripePaymentIntentId: PI })
    const stamped = before?.refundedAt
    await POST(webhookRequest({ ...payload, id: `evt_ref_idem2_${Date.now()}` }))
    const after = await Payment.findOne({ stripePaymentIntentId: PI })
    expect(after?.refundedAt?.getTime()).toBe(stamped?.getTime())
  })

  it('closes disputes with non-terminal status via save', async () => {
    await seedPayment({ disputeStatus: 'needs_response', disputedAt: new Date() })
    const { POST } = await import('./route-logic/stripe/webhook')
    const res = await POST(
      webhookRequest({
        id: `evt_dp_review_${Date.now()}`,
        type: 'charge.dispute.closed',
        data: {
          object: {
            id: 'dp_review',
            charge: 'ch_probe',
            status: 'under_review',
            payment_intent: PI,
          },
        },
      }),
    )
    expect(res.status).toBe(200)
    const { Payment } = await import('./models')
    expect((await Payment.findOne({ stripePaymentIntentId: PI }))?.disputeStatus).toBe('under_review')
  })

  it('returns 500 when the handler throws', async () => {
    await seedPayment()
    const models = await import('./models')
    const spy = vi.spyOn(models.Payment, 'findOne').mockRejectedValueOnce(new Error('db down'))
    try {
      const { POST } = await import('./route-logic/stripe/webhook')
      const res = await POST(
        webhookRequest({
          id: `evt_fail_${Date.now()}`,
          type: 'charge.refunded',
          data: {
            object: {
              id: 'ch_fail',
              payment_intent: PI,
              amount_refunded: 1000,
              currency: 'usd',
            },
          },
        }),
      )
      expect(res.status).toBe(500)
      expect((await res.json()).error).toBe('handler-error')
    } finally {
      spy.mockRestore()
    }
  })

  it('syncs refund when a dispute is lost', async () => {
    await seedPayment({ disputedAt: new Date(), disputeStatus: 'needs_response' })
    stripeMocks.charges.retrieve.mockResolvedValueOnce({
      id: 'ch_lost',
      payment_intent: PI,
      amount_refunded: 10000,
      currency: 'usd',
    })
    const { POST } = await import('./route-logic/stripe/webhook')
    const res = await POST(
      webhookRequest({
        id: `evt_dp_lost_${Date.now()}`,
        type: 'charge.dispute.closed',
        data: {
          object: {
            id: 'dp_lost',
            charge: 'ch_lost',
            status: 'lost',
            payment_intent: PI,
          },
        },
      }),
    )
    expect(res.status).toBe(200)
    const { Payment } = await import('./models')
    const row = await Payment.findOne({ stripePaymentIntentId: PI })
    expect(Number(row?.refundedAmount || 0)).toBeGreaterThan(0)
    expect(row?.disputeStatus).toBe('lost')
  })

  it('updates soft-deleted payments on charge.refunded', async () => {
    await seedPayment()
    const { Payment } = await import('./models')
    await Payment.updateOne(
      { stripePaymentIntentId: PI },
      { $set: { deletedAt: new Date() } },
    )

    const { POST } = await import('./route-logic/stripe/webhook')
    const res = await POST(
      webhookRequest({
        id: `evt_ref_soft_${Date.now()}`,
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_soft',
            payment_intent: PI,
            amount_refunded: 2500,
            currency: 'usd',
          },
        },
      }),
    )
    expect(res.status).toBe(200)
    const row = await Payment.findOne(
      { stripePaymentIntentId: PI },
      null,
      { includeDeleted: true },
    )
    expect(Number(row?.refundedAmount || 0)).toBeGreaterThan(0)
    await Payment.updateOne({ stripePaymentIntentId: PI }, { $unset: { deletedAt: 1 } })
  })

  it('handles dispute funds withdrawn and reinstated', async () => {
    await seedPayment({ disputeStatus: 'needs_response', disputedAt: new Date() })
    const { POST } = await import('./route-logic/stripe/webhook')
    for (const type of ['charge.dispute.funds_withdrawn', 'charge.dispute.funds_reinstated'] as const) {
      const res = await POST(
        webhookRequest({
          id: `evt_${type}_${Date.now()}`,
          type,
          data: {
            object: {
              id: 'dp_probe',
              charge: 'ch_probe',
              status: type.endsWith('reinstated') ? 'won' : 'lost',
              payment_intent: PI,
            },
          },
        }),
      )
      expect(res.status).toBe(200)
    }
  })

  it('backstops a ledger row from payment_intent.succeeded when none exists', async () => {
    const backstopPi = 'pi_backstoponly01'
    const { Organization, Family, Payment } = await import('./models')
    await Organization.create({
      _id: orgId,
      name: 'Webhook Org',
      slug: `wh-${orgId.toString().slice(-6)}`,
      ownerId: new Types.ObjectId(),
      timezone: 'America/New_York',
      currency: 'USD',
    })
    await Family.create({
      _id: familyId,
      organizationId: orgId,
      name: 'Webhook Family',
      weddingDate: new Date('2015-01-01'),
      email: 'webhook-family@example.com',
    })
    await Payment.deleteMany({ stripePaymentIntentId: backstopPi })

    const { POST } = await import('./route-logic/stripe/webhook')
    const res = await POST(
      webhookRequest({
        id: `evt_pi_succ_backstop_${Date.now()}`,
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: backstopPi,
            amount: 4200,
            currency: 'usd',
            created: Math.floor(Date.now() / 1000),
            metadata: { organizationId: orgId.toString(), familyId: familyId.toString() },
          },
        },
      }),
    )
    expect(res.status).toBe(200)
    const row = await Payment.findOne({ stripePaymentIntentId: backstopPi })
    expect(row).toBeTruthy()
    expect(String(row?.notes || '')).toMatch(/webhook/i)
  })

  it('skips payment_intent.succeeded backstop when a soft-deleted payment exists', async () => {
    const softPi = 'pi_softdeleted01'
    await seedPayment({
      stripePaymentIntentId: softPi,
      deletedAt: new Date(),
    })
    const { Payment } = await import('./models')
    const before = await Payment.countDocuments({ stripePaymentIntentId: softPi })

    const { POST } = await import('./route-logic/stripe/webhook')
    const res = await POST(
      webhookRequest({
        id: `evt_pi_soft_${Date.now()}`,
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: softPi,
            amount: 9900,
            currency: 'usd',
            metadata: { organizationId: orgId.toString(), familyId: familyId.toString() },
          },
        },
      }),
    )
    expect(res.status).toBe(200)
    const after = await Payment.countDocuments({ stripePaymentIntentId: softPi })
    expect(after).toBe(before)
  })

  it('creates an admin task when payment_intent.canceled', async () => {
    await seedPayment()
    const { Task } = await import('./models')
    const cancelPi = `pi_canceled_${Date.now()}`
    await Task.deleteMany({
      organizationId: orgId,
      notes: { $regex: cancelPi.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') },
    })

    const { POST } = await import('./route-logic/stripe/webhook')
    const res = await POST(
      webhookRequest({
        id: `evt_pi_cancel_${Date.now()}`,
        type: 'payment_intent.canceled',
        data: {
          object: {
            id: cancelPi,
            amount: 1500,
            currency: 'usd',
            cancellation_reason: 'abandoned',
            metadata: { organizationId: orgId.toString(), familyId: familyId.toString() },
          },
        },
      }),
    )
    expect(res.status).toBe(200)
    const task = await Task.findOne({
      organizationId: orgId,
      relatedFamilyId: familyId,
      notes: { $regex: cancelPi },
    })
    expect(task).toBeTruthy()
  })

  it('no-ops dispute handlers when charge retrieve fails', async () => {
    await seedPayment()
    stripeMocks.charges.retrieve.mockRejectedValueOnce(new Error('stripe unavailable'))
    const { POST } = await import('./route-logic/stripe/webhook')
    const res = await POST(
      webhookRequest({
        id: `evt_dp_retrieve_fail_${Date.now()}`,
        type: 'charge.dispute.funds_withdrawn',
        data: {
          object: {
            id: 'dp_retrieve_fail',
            charge: 'ch_missing',
            status: 'lost',
            payment_intent: PI,
          },
        },
      }),
    )
    expect(res.status).toBe(200)
  })

  it('returns 400 when stripe signature verification fails', async () => {
    stripeMocks.constructEvent.mockImplementationOnce(() => {
      throw new Error('bad signature')
    })
    const { POST } = await import('./route-logic/stripe/webhook')
    const res = await POST(
      webhookRequest({
        id: `evt_bad_sig_${Date.now()}`,
        type: 'charge.refunded',
        data: { object: { id: 'ch_x', payment_intent: PI, amount_refunded: 0, currency: 'usd' } },
      }),
    )
    expect(res.status).toBe(400)
    stripeMocks.constructEvent.mockImplementation((rawBody: string | Buffer) => {
      const text = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')
      return JSON.parse(text)
    })
  })
})
