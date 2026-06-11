/**
 * Branch/function coverage for lib/route-logic/stripe/webhook.ts only.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { Types } from 'mongoose'
import { NextRequest } from 'next/server'
import {
  seedApiRouteFixtures,
  teardownApiRouteFixtures,
  type ApiTestContext,
} from '@/lib/test/api-route-fixtures'

const API_ORIGIN = 'http://localhost:3000'
let ctx: ApiTestContext

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
    charges: { retrieve: ReturnType<typeof vi.fn> }
  }
}

describe.sequential('webhook.ts branch coverage', () => {
  const year = () => new Date().getFullYear()

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test'
    process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test'
    ctx = await seedApiRouteFixtures()
    process.env.KASA_TEST_STRIPE_ORG = ctx.orgId
    process.env.KASA_TEST_STRIPE_FAMILY = ctx.fixtures.familyId
  })

  afterAll(async () => {
    await teardownApiRouteFixtures()
    vi.restoreAllMocks()
  })

  afterEach(async () => {
    const { Task, Payment, StripeWebhookEvent } = await import('@/lib/models')
    await Task.deleteMany({ organizationId: ctx.orgId })
    await StripeWebhookEvent.deleteMany({})
    await Payment.deleteMany({ organizationId: ctx.orgId, notes: /webhook-br-/ })
  })

  describe('POST entry guards', () => {
    it('returns 400 without stripe-signature header', async () => {
      const { POST } = await import('@/lib/route-logic/stripe/webhook')
      const res = await POST(
        new NextRequest(`${API_ORIGIN}/api/stripe/webhook`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: `evt_nosig_${Date.now()}`, type: 'ping', data: {} }),
        }),
      )
      expect(res.status).toBe(400)
    })

    it('returns 400 when signature verification fails', async () => {
      const client = await stripeTestClient()
      client.webhooks.constructEvent.mockImplementationOnce(() => {
        throw new Error('bad signature')
      })
      const { POST } = await import('@/lib/route-logic/stripe/webhook')
      const res = await POST(
        webhookReq({
          id: `evt_badsig_${Date.now()}`,
          type: 'charge.refunded',
          data: { object: { id: 'ch_x', payment_intent: 'pi_x', currency: 'usd' } },
        }),
      )
      expect(res.status).toBe(400)
    })

    it('deduplicates on duplicate event id (11000)', async () => {
      const eventId = `evt_dedup_${Date.now()}`
      const payload = {
        id: eventId,
        type: 'customer.created',
        data: { object: { id: 'cus_x' } },
      }
      const { POST } = await import('@/lib/route-logic/stripe/webhook')
      const first = await POST(webhookReq(payload))
      const second = await POST(webhookReq(payload))
      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect((await second.json()).deduplicated).toBe(true)
    })

    it('rethrows non-duplicate StripeWebhookEvent.create errors', async () => {
      const { StripeWebhookEvent } = await import('@/lib/models')
      const createSpy = vi
        .spyOn(StripeWebhookEvent, 'create')
        .mockRejectedValueOnce(new Error('db fail'))
      try {
        const { POST } = await import('@/lib/route-logic/stripe/webhook')
        const res = await POST(
          webhookReq({ id: `evt_throw_${Date.now()}`, type: 'ping', data: {} }),
        )
        expect(res.status).toBe(500)
      } finally {
        createSpy.mockRestore()
      }
    })

    it('acks unknown event types via default switch arm', async () => {
      const { POST } = await import('@/lib/route-logic/stripe/webhook')
      const res = await POST(
        webhookReq({
          id: `evt_unknown_${Date.now()}`,
          type: 'invoice.paid',
          data: { object: { id: 'in_x' } },
        }),
      )
      expect(res.status).toBe(200)
      expect((await res.json()).received).toBe(true)
    })
  })

  describe('handleChargeRefunded', () => {
    it('updates refundedAmount when refund increases (string payment_intent)', async () => {
      const piId = `pi_ref_str_${Date.now()}`
      const { Payment } = await import('@/lib/models')
      await Payment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        amount: 100,
        paymentDate: new Date(),
        year: year(),
        type: 'membership',
        paymentMethod: 'credit_card',
        stripePaymentIntentId: piId,
        notes: 'webhook-br-ref-str',
      })

      const { POST } = await import('@/lib/route-logic/stripe/webhook')
      const res = await POST(
        webhookReq({
          id: `evt_ref_str_${Date.now()}`,
          type: 'charge.refunded',
          data: {
            object: {
              id: 'ch_ref_str',
              payment_intent: piId,
              amount_refunded: 5000,
              currency: 'usd',
            },
          },
        }),
      )
      expect(res.status).toBe(200)
      const row = await Payment.findOne({ stripePaymentIntentId: piId })
      expect(Number(row?.refundedAmount)).toBe(50)
      expect(row?.refundedAt).toBeTruthy()
    })

    it('is idempotent when refunded amount does not increase', async () => {
      const piId = `pi_ref_idem_${Date.now()}`
      const stamped = new Date('2024-06-01')
      const { Payment } = await import('@/lib/models')
      await Payment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        amount: 100,
        paymentDate: new Date(),
        year: year(),
        type: 'membership',
        paymentMethod: 'credit_card',
        stripePaymentIntentId: piId,
        refundedAmount: 50,
        refundedAt: stamped,
        notes: 'webhook-br-ref-idem',
      })

      const { POST } = await import('@/lib/route-logic/stripe/webhook')
      await POST(
        webhookReq({
          id: `evt_ref_idem_${Date.now()}`,
          type: 'charge.refunded',
          data: {
            object: {
              id: 'ch_ref_idem',
              payment_intent: piId,
              amount_refunded: 5000,
              currency: 'usd',
            },
          },
        }),
      )
      const row = await Payment.findOne({ stripePaymentIntentId: piId })
      expect(row?.refundedAt?.getTime()).toBe(stamped.getTime())
    })

    it('treats missing amount_refunded and currency as zero/usd', async () => {
      const piId = `pi_ref_opt_${Date.now()}`
      const { Payment } = await import('@/lib/models')
      await Payment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        amount: 10,
        paymentDate: new Date(),
        year: year(),
        type: 'membership',
        paymentMethod: 'credit_card',
        stripePaymentIntentId: piId,
        notes: 'webhook-br-ref-opt',
      })

      const { POST } = await import('@/lib/route-logic/stripe/webhook')
      expect(
        (
          await POST(
            webhookReq({
              id: `evt_ref_opt_${Date.now()}`,
              type: 'charge.refunded',
              data: { object: { id: 'ch_ref_opt', payment_intent: piId } },
            }),
          )
        ).status,
      ).toBe(200)
      const row = await Payment.findOne({ stripePaymentIntentId: piId })
      expect(Number(row?.refundedAmount || 0)).toBe(0)
    })
  })

  describe('handleDisputeCreated', () => {
    it('no-ops when charge retrieve fails or payment_intent missing', async () => {
      const client = await stripeTestClient()
      const { POST } = await import('@/lib/route-logic/stripe/webhook')

      client.charges.retrieve.mockRejectedValueOnce(new Error('missing'))
      expect(
        (
          await POST(
            webhookReq({
              id: `evt_dp_ret_${Date.now()}`,
              type: 'charge.dispute.created',
              data: { object: { id: 'dp_ret', charge: 'ch_missing' } },
            }),
          )
        ).status,
      ).toBe(200)

      client.charges.retrieve.mockResolvedValueOnce({
        id: 'ch_no_pi',
        payment_intent: null,
        amount_refunded: 0,
        currency: 'usd',
      })
      expect(
        (
          await POST(
            webhookReq({
              id: `evt_dp_nopi_${Date.now()}`,
              type: 'charge.dispute.created',
              data: { object: { id: 'dp_nopi', charge: 'ch_no_pi' } },
            }),
          )
        ).status,
      ).toBe(200)
    })

    it('opens task with object charge and no evidence deadline', async () => {
      const piId = `pi_dp_obj_${Date.now()}`
      const disputeId = `dp_obj_${Date.now()}`
      const { Payment, Task } = await import('@/lib/models')
      await Payment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        amount: 80,
        paymentDate: new Date(),
        year: year(),
        type: 'membership',
        paymentMethod: 'credit_card',
        stripePaymentIntentId: piId,
        notes: 'webhook-br-dp-obj',
      })

      const client = await stripeTestClient()
      client.charges.retrieve.mockResolvedValueOnce({
        id: 'ch_dp_obj',
        payment_intent: { id: piId },
        amount_refunded: 0,
        currency: 'usd',
      })

      const { POST } = await import('@/lib/route-logic/stripe/webhook')
      expect(
        (
          await POST(
            webhookReq({
              id: `evt_dp_obj_${Date.now()}`,
              type: 'charge.dispute.created',
              data: {
                object: {
                  id: disputeId,
                  charge: { id: 'ch_dp_obj' },
                  reason: undefined,
                  evidence_details: {},
                },
              },
            }),
          )
        ).status,
      ).toBe(200)

      const task = await Task.findOne({ organizationId: ctx.orgId, notes: { $regex: disputeId } })
      expect(task?.description).toMatch(/Stripe-set deadline/)
      expect(task?.dueDate).toBeTruthy()
    })

    it('no-ops when dispute charge id is missing', async () => {
      const { POST } = await import('@/lib/route-logic/stripe/webhook')
      expect(
        (
          await POST(
            webhookReq({
              id: `evt_dp_nochg_${Date.now()}`,
              type: 'charge.dispute.created',
              data: { object: { id: 'dp_nochg' } },
            }),
          )
        ).status,
      ).toBe(200)
    })

    it('no-ops when payment row is absent', async () => {
      const piId = `pi_dp_nopay_${Date.now()}`
      const client = await stripeTestClient()
      client.charges.retrieve.mockResolvedValueOnce({
        id: 'ch_nopay',
        payment_intent: piId,
        amount_refunded: 0,
        currency: 'usd',
      })
      const { POST } = await import('@/lib/route-logic/stripe/webhook')
      expect(
        (
          await POST(
            webhookReq({
              id: `evt_dp_nopay_${Date.now()}`,
              type: 'charge.dispute.created',
              data: { object: { id: 'dp_nopay', charge: 'ch_nopay' } },
            }),
          )
        ).status,
      ).toBe(200)
    })
  })

  describe('handleDisputeClosed', () => {
    async function seedDisputePayment(piId: string, extra: Record<string, unknown> = {}) {
      const { Payment } = await import('@/lib/models')
      await Payment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        amount: 100,
        paymentDate: new Date(),
        year: year(),
        type: 'membership',
        paymentMethod: 'credit_card',
        stripePaymentIntentId: piId,
        notes: 'webhook-br-dp-closed',
        ...extra,
      })
    }

    it('syncs refund on lost dispute (string charge)', async () => {
      const piId = `pi_dp_lost_${Date.now()}`
      await seedDisputePayment(piId, { disputedAt: new Date(), disputeStatus: 'needs_response' })

      const client = await stripeTestClient()
      const lostCharge = {
        id: 'ch_lost',
        payment_intent: piId,
        amount_refunded: 10000,
        currency: 'usd',
      }
      client.charges.retrieve
        .mockResolvedValueOnce(lostCharge)
        .mockResolvedValueOnce(lostCharge)

      const { POST } = await import('@/lib/route-logic/stripe/webhook')
      expect(
        (
          await POST(
            webhookReq({
              id: `evt_dp_lost_${Date.now()}`,
              type: 'charge.dispute.closed',
              data: {
                object: { id: 'dp_lost', charge: 'ch_lost', status: 'lost' },
              },
            }),
          )
        ).status,
      ).toBe(200)

      const { Payment } = await import('@/lib/models')
      const row = await Payment.findOne({ stripePaymentIntentId: piId })
      expect(row?.disputeStatus).toBe('lost')
      expect(Number(row?.refundedAmount || 0)).toBe(100)
    })

    it('syncs refund on won dispute (object charge)', async () => {
      const piId = `pi_dp_won_${Date.now()}`
      await seedDisputePayment(piId, {
        disputedAt: new Date(),
        disputeStatus: 'needs_response',
        refundedAmount: 50,
        refundedAt: new Date(),
      })

      const client = await stripeTestClient()
      const wonCharge = {
        id: 'ch_won',
        payment_intent: { id: piId },
        amount_refunded: 0,
      }
      client.charges.retrieve
        .mockResolvedValueOnce(wonCharge)
        .mockResolvedValueOnce(wonCharge)

      const { POST } = await import('@/lib/route-logic/stripe/webhook')
      expect(
        (
          await POST(
            webhookReq({
              id: `evt_dp_won_${Date.now()}`,
              type: 'charge.dispute.closed',
              data: {
                object: { id: 'dp_won', charge: { id: 'ch_won' }, status: 'won' },
              },
            }),
          )
        ).status,
      ).toBe(200)

      const { Payment } = await import('@/lib/models')
      const row = await Payment.findOne({ stripePaymentIntentId: piId })
      expect(row?.disputeStatus).toBe('won')
      expect(Number(row?.refundedAmount || 0)).toBe(0)
      expect(row?.refundedAt).toBeUndefined()
    })

    it('saves non-terminal status without sync', async () => {
      const piId = `pi_dp_review_${Date.now()}`
      await seedDisputePayment(piId, { disputeStatus: 'needs_response', disputedAt: new Date() })

      const client = await stripeTestClient()
      client.charges.retrieve.mockResolvedValueOnce({
        id: 'ch_review',
        payment_intent: piId,
        amount_refunded: 0,
        currency: 'usd',
      })

      const { POST } = await import('@/lib/route-logic/stripe/webhook')
      expect(
        (
          await POST(
            webhookReq({
              id: `evt_dp_review_${Date.now()}`,
              type: 'charge.dispute.closed',
              data: {
                object: { id: 'dp_review', charge: 'ch_review', status: 'under_review' },
              },
            }),
          )
        ).status,
      ).toBe(200)

      const { Payment } = await import('@/lib/models')
      expect((await Payment.findOne({ stripePaymentIntentId: piId }))?.disputeStatus).toBe(
        'under_review',
      )
    })

    it('no-ops dispute.closed when charge id is missing', async () => {
      const { POST } = await import('@/lib/route-logic/stripe/webhook')
      expect(
        (
          await POST(
            webhookReq({
              id: `evt_dp_close_nochg_${Date.now()}`,
              type: 'charge.dispute.closed',
              data: { object: { id: 'dp_nochg', status: 'won' } },
            }),
          )
        ).status,
      ).toBe(200)
    })

    it('no-ops when charge retrieve fails or payment absent', async () => {
      const client = await stripeTestClient()
      const { POST } = await import('@/lib/route-logic/stripe/webhook')

      client.charges.retrieve.mockRejectedValueOnce(new Error('stripe down'))
      expect(
        (
          await POST(
            webhookReq({
              id: `evt_dp_close_fail_${Date.now()}`,
              type: 'charge.dispute.closed',
              data: { object: { id: 'dp_x', charge: 'ch_x', status: 'won' } },
            }),
          )
        ).status,
      ).toBe(200)

      client.charges.retrieve.mockResolvedValueOnce({
        id: 'ch_nopi_close',
        payment_intent: null,
        amount_refunded: 0,
        currency: 'usd',
      })
      expect(
        (
          await POST(
            webhookReq({
              id: `evt_dp_close_nopi_${Date.now()}`,
              type: 'charge.dispute.closed',
              data: { object: { id: 'dp_nopi', charge: 'ch_nopi_close' } },
            }),
          )
        ).status,
      ).toBe(200)

      const piId = `pi_dp_close_nopay_${Date.now()}`
      client.charges.retrieve.mockResolvedValueOnce({
        id: 'ch_nopay_close',
        payment_intent: piId,
        amount_refunded: 0,
        currency: 'usd',
      })
      expect(
        (
          await POST(
            webhookReq({
              id: `evt_dp_close_nopay_${Date.now()}`,
              type: 'charge.dispute.closed',
              data: { object: { id: 'dp_nopay', charge: 'ch_nopay_close', status: undefined } },
            }),
          )
        ).status,
      ).toBe(200)
    })
  })

  describe('dispute funds withdrawn / reinstated', () => {
    it('syncs refund using string charge id on funds_withdrawn', async () => {
      const piId = `pi_funds_str_${Date.now()}`
      const { Payment } = await import('@/lib/models')
      await Payment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        amount: 60,
        paymentDate: new Date(),
        year: year(),
        type: 'membership',
        paymentMethod: 'credit_card',
        stripePaymentIntentId: piId,
        notes: 'webhook-br-funds-str',
      })

      const client = await stripeTestClient()
      const charge = { id: 'ch_funds_str', payment_intent: piId, amount_refunded: 3000 }
      client.charges.retrieve.mockResolvedValueOnce(charge).mockResolvedValueOnce(charge)

      const { POST } = await import('@/lib/route-logic/stripe/webhook')
      expect(
        (
          await POST(
            webhookReq({
              id: `evt_funds_str_${Date.now()}`,
              type: 'charge.dispute.funds_withdrawn',
              data: { object: { id: 'dp_str', charge: 'ch_funds_str', status: 'lost' } },
            }),
          )
        ).status,
      ).toBe(200)
      expect(Number((await Payment.findOne({ stripePaymentIntentId: piId }))?.refundedAmount)).toBe(
        30,
      )
    })

    it('syncs refund on funds_withdrawn and funds_reinstated', async () => {
      const piId = `pi_funds_${Date.now()}`
      const { Payment } = await import('@/lib/models')
      await Payment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        amount: 100,
        paymentDate: new Date(),
        year: year(),
        type: 'membership',
        paymentMethod: 'credit_card',
        stripePaymentIntentId: piId,
        disputeStatus: 'needs_response',
        disputedAt: new Date(),
        notes: 'webhook-br-funds',
      })

      const client = await stripeTestClient()
      const { POST } = await import('@/lib/route-logic/stripe/webhook')

      const withdrawCharge = {
        id: 'ch_withdraw',
        payment_intent: piId,
        amount_refunded: 5000,
        currency: 'usd',
      }
      client.charges.retrieve
        .mockResolvedValueOnce(withdrawCharge)
        .mockResolvedValueOnce(withdrawCharge)
      expect(
        (
          await POST(
            webhookReq({
              id: `evt_funds_w_${Date.now()}`,
              type: 'charge.dispute.funds_withdrawn',
              data: {
                object: {
                  id: 'dp_withdraw',
                  charge: { id: 'ch_withdraw' },
                  status: 'needs_response',
                },
              },
            }),
          )
        ).status,
      ).toBe(200)

      let row = await Payment.findOne({ stripePaymentIntentId: piId })
      expect(row?.disputeStatus).toBe('needs_response')
      expect(Number(row?.refundedAmount || 0)).toBe(50)

      const reinstateCharge = {
        id: 'ch_reinstate',
        payment_intent: { id: piId },
        amount_refunded: 0,
        currency: 'usd',
      }
      client.charges.retrieve
        .mockResolvedValueOnce(reinstateCharge)
        .mockResolvedValueOnce(reinstateCharge)
      expect(
        (
          await POST(
            webhookReq({
              id: `evt_funds_r_${Date.now()}`,
              type: 'charge.dispute.funds_reinstated',
              data: {
                object: { id: 'dp_reinstate', charge: 'ch_reinstate', status: 'won' },
              },
            }),
          )
        ).status,
      ).toBe(200)

      row = await Payment.findOne({ stripePaymentIntentId: piId })
      expect(row?.disputeStatus).toBe('won')
      expect(Number(row?.refundedAmount || 0)).toBe(0)
    })

    it('no-ops funds handlers without charge id or payment row', async () => {
      const { POST } = await import('@/lib/route-logic/stripe/webhook')
      expect(
        (
          await POST(
            webhookReq({
              id: `evt_funds_nochg_${Date.now()}`,
              type: 'charge.dispute.funds_withdrawn',
              data: { object: { id: 'dp_nochg' } },
            }),
          )
        ).status,
      ).toBe(200)

      const piId = `pi_funds_nopay_${Date.now()}`
      const client = await stripeTestClient()
      client.charges.retrieve.mockResolvedValueOnce({
        id: 'ch_funds_nopay',
        payment_intent: piId,
        amount_refunded: 0,
      })
      expect(
        (
          await POST(
            webhookReq({
              id: `evt_funds_nopay_${Date.now()}`,
              type: 'charge.dispute.funds_withdrawn',
              data: { object: { id: 'dp_nopay', charge: 'ch_funds_nopay' } },
            }),
          )
        ).status,
      ).toBe(200)

      client.charges.retrieve.mockResolvedValueOnce({
        id: 'ch_re_nopay',
        payment_intent: piId,
        amount_refunded: 0,
        currency: 'usd',
      })
      expect(
        (
          await POST(
            webhookReq({
              id: `evt_re_nopay_${Date.now()}`,
              type: 'charge.dispute.funds_reinstated',
              data: { object: { id: 'dp_re_nopay', charge: 'ch_re_nopay' } },
            }),
          )
        ).status,
      ).toBe(200)
    })

    it('no-ops funds handlers when charge retrieve fails or payment missing', async () => {
      const client = await stripeTestClient()
      const { POST } = await import('@/lib/route-logic/stripe/webhook')

      client.charges.retrieve.mockRejectedValueOnce(new Error('stripe down'))
      expect(
        (
          await POST(
            webhookReq({
              id: `evt_funds_w_fail_${Date.now()}`,
              type: 'charge.dispute.funds_withdrawn',
              data: { object: { id: 'dp_wf', charge: 'ch_wf' } },
            }),
          )
        ).status,
      ).toBe(200)

      client.charges.retrieve.mockRejectedValueOnce(new Error('stripe down'))
      expect(
        (
          await POST(
            webhookReq({
              id: `evt_funds_r_fail_${Date.now()}`,
              type: 'charge.dispute.funds_reinstated',
              data: { object: { id: 'dp_rf', charge: 'ch_rf' } },
            }),
          )
        ).status,
      ).toBe(200)

      client.charges.retrieve.mockResolvedValueOnce({
        id: 'ch_nopi',
        payment_intent: null,
        amount_refunded: 0,
        currency: 'usd',
      })
      expect(
        (
          await POST(
            webhookReq({
              id: `evt_funds_nopi_${Date.now()}`,
              type: 'charge.dispute.funds_withdrawn',
              data: { object: { id: 'dp_nopi', charge: 'ch_nopi' } },
            }),
          )
        ).status,
      ).toBe(200)
    })

    it('no-ops syncPaymentRefundFromStripeCharge when charge retrieve fails', async () => {
      const piId = `pi_sync_fail_${Date.now()}`
      const { Payment } = await import('@/lib/models')
      await Payment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        amount: 50,
        paymentDate: new Date(),
        year: year(),
        type: 'membership',
        paymentMethod: 'credit_card',
        stripePaymentIntentId: piId,
        notes: 'webhook-br-sync-fail',
      })

      const client = await stripeTestClient()
      const syncCharge = {
        id: 'ch_sync_ok',
        payment_intent: piId,
        amount_refunded: 0,
        currency: 'usd',
      }
      client.charges.retrieve
        .mockResolvedValueOnce(syncCharge)
        .mockResolvedValueOnce(syncCharge)
        .mockResolvedValueOnce(syncCharge)
        .mockRejectedValueOnce(new Error('missing'))

      const { POST } = await import('@/lib/route-logic/stripe/webhook')
      await POST(
        webhookReq({
          id: `evt_funds_ok_${Date.now()}`,
          type: 'charge.dispute.funds_withdrawn',
          data: { object: { id: 'dp_ok', charge: 'ch_sync_ok' } },
        }),
      )
      expect(
        (
          await POST(
            webhookReq({
              id: `evt_funds_fail_${Date.now()}`,
              type: 'charge.dispute.funds_reinstated',
              data: { object: { id: 'dp_fail', charge: 'ch_sync_ok' } },
            }),
          )
        ).status,
      ).toBe(200)
    })
  })

  describe('payment_intent handlers', () => {
    it('skips canceled handler when family is missing', async () => {
      const bogusFamily = new Types.ObjectId().toString()
      const { POST } = await import('@/lib/route-logic/stripe/webhook')
      expect(
        (
          await POST(
            webhookReq({
              id: `evt_cancel_nofam_${Date.now()}`,
              type: 'payment_intent.canceled',
              data: {
                object: {
                  id: `pi_cancel_nofam_${Date.now()}`,
                  amount: 1500,
                  currency: 'usd',
                  cancellation_reason: 'abandoned',
                  metadata: { organizationId: ctx.orgId, familyId: bogusFamily },
                },
              },
            }),
          )
        ).status,
      ).toBe(200)
    })

    it('creates canceled task and skips duplicate', async () => {
      const cancelPi = `pi_cancel_br_${Date.now()}`
      const { Task } = await import('@/lib/models')
      await Task.deleteMany({ organizationId: ctx.orgId, notes: { $regex: cancelPi } })

      const { POST } = await import('@/lib/route-logic/stripe/webhook')
      const payload = {
        id: `evt_cancel_${Date.now()}`,
        type: 'payment_intent.canceled',
        data: {
          object: {
            id: cancelPi,
            amount: 1500,
            currency: 'usd',
            cancellation_reason: 'abandoned',
            metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
          },
        },
      }
      expect((await POST(webhookReq(payload))).status).toBe(200)
      const task = await Task.findOne({
        organizationId: ctx.orgId,
        notes: { $regex: cancelPi },
      })
      expect(task?.title).toMatch(/canceled/i)
      expect(task?.description).toMatch(/abandoned/)

      await POST(
        webhookReq({
          ...payload,
          id: `evt_cancel_dup_${Date.now()}`,
        }),
      )
      expect(
        await Task.countDocuments({ organizationId: ctx.orgId, notes: { $regex: cancelPi } }),
      ).toBe(1)
    })

    it('skips backstop when payment already exists', async () => {
      const piId = `pi_exists_${Date.now()}`
      const { Payment } = await import('@/lib/models')
      await Payment.create({
        organizationId: ctx.orgId,
        familyId: ctx.fixtures.familyId,
        amount: 30,
        paymentDate: new Date(),
        year: year(),
        type: 'membership',
        paymentMethod: 'credit_card',
        stripePaymentIntentId: piId,
        notes: 'webhook-br-exists',
      })

      const { POST } = await import('@/lib/route-logic/stripe/webhook')
      expect(
        (
          await POST(
            webhookReq({
              id: `evt_pi_exists_${Date.now()}`,
              type: 'payment_intent.succeeded',
              data: {
                object: {
                  id: piId,
                  amount: 0,
                  currency: undefined,
                  metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
                },
              },
            }),
          )
        ).status,
      ).toBe(200)
    })

    it('rethrows non-duplicate errors from payment_intent.succeeded backstop', async () => {
      const piId = `pi_create_err_${Date.now()}`
      const { Payment } = await import('@/lib/models')
      await Payment.deleteMany({ stripePaymentIntentId: piId })
      const createSpy = vi
        .spyOn(Payment, 'create')
        .mockRejectedValueOnce(new Error('create failed'))
      try {
        const { POST } = await import('@/lib/route-logic/stripe/webhook')
        const res = await POST(
          webhookReq({
            id: `evt_pi_create_err_${Date.now()}`,
            type: 'payment_intent.succeeded',
            data: {
              object: {
                id: piId,
                amount: 900,
                currency: 'usd',
                metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
              },
            },
          }),
        )
        expect(res.status).toBe(500)
      } finally {
        createSpy.mockRestore()
      }
    })

    it('backstops payment_intent.succeeded with org timezone and duplicate key', async () => {
      const piId = `pi_backstop_${Date.now()}`
      const { Payment, Organization } = await import('@/lib/models')
      await Payment.deleteMany({ stripePaymentIntentId: piId })
      await Organization.updateOne({ _id: ctx.orgId }, { $set: { timezone: 'America/New_York' } })

      const { POST } = await import('@/lib/route-logic/stripe/webhook')
      expect(
        (
          await POST(
            webhookReq({
              id: `evt_pi_back_${Date.now()}`,
              type: 'payment_intent.succeeded',
              data: {
                object: {
                  id: piId,
                  created: 'not-a-number' as unknown as number,
                  metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
                },
              },
            }),
          )
        ).status,
      ).toBe(200)
      const row = await Payment.findOne({ stripePaymentIntentId: piId })
      expect(row).toBeTruthy()
      expect(Number(row?.amount)).toBe(0)

      const dupErr = Object.assign(new Error('dup'), { code: 11000 })
      const createSpy = vi.spyOn(Payment, 'create').mockRejectedValueOnce(dupErr)
      try {
        const piDup = `pi_dup_back_${Date.now()}`
        expect(
          (
            await POST(
              webhookReq({
                id: `evt_pi_dup_${Date.now()}`,
                type: 'payment_intent.succeeded',
                data: {
                  object: {
                    id: piDup,
                    amount: 1200,
                    currency: 'usd',
                    created: Math.floor(Date.now() / 1000),
                    metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
                  },
                },
              }),
            )
          ).status,
        ).toBe(200)
      } finally {
        createSpy.mockRestore()
        await Payment.deleteMany({ stripePaymentIntentId: piId })
      }
    })

    it('creates payment_failed task with family name and default error message', async () => {
      const piId = `pi_fail_full_${Date.now()}`
      const { Family, Task } = await import('@/lib/models')
      const family = await Family.findOne({ _id: ctx.fixtures.familyId, organizationId: ctx.orgId })
      expect(family?.name).toBeTruthy()

      const { POST } = await import('@/lib/route-logic/stripe/webhook')
      expect(
        (
          await POST(
            webhookReq({
              id: `evt_fail_full_${Date.now()}`,
              type: 'payment_intent.payment_failed',
              data: {
                object: {
                  id: piId,
                  metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
                },
              },
            }),
          )
        ).status,
      ).toBe(200)

      const task = await Task.findOne({ organizationId: ctx.orgId, notes: { $regex: piId } })
      expect(task?.description).toMatch(/Card declined/)
      expect(task?.description).toMatch(new RegExp(family!.name!, 'i'))
      await Task.deleteMany({ notes: { $regex: piId } })
    })

    it('skips payment_failed when task exists or family missing', async () => {
      const piId = `pi_fail_skip_${Date.now()}`
      const { Task } = await import('@/lib/models')
      await Task.create({
        organizationId: ctx.orgId,
        relatedFamilyId: ctx.fixtures.familyId,
        title: 'existing',
        description: 'x',
        dueDate: new Date(),
        email: 'admin@kasa.com',
        status: 'pending',
        priority: 'high',
        notes: `Stripe PaymentIntent ${piId}.`,
      })

      const { POST } = await import('@/lib/route-logic/stripe/webhook')
      expect(
        (
          await POST(
            webhookReq({
              id: `evt_fail_skip_${Date.now()}`,
              type: 'payment_intent.payment_failed',
              data: {
                object: {
                  id: piId,
                  amount: 1000,
                  currency: 'usd',
                  metadata: { organizationId: ctx.orgId, familyId: ctx.fixtures.familyId },
                },
              },
            }),
          )
        ).status,
      ).toBe(200)

      const bogusFamily = new Types.ObjectId().toString()
      expect(
        (
          await POST(
            webhookReq({
              id: `evt_fail_nofam_${Date.now()}`,
              type: 'payment_intent.payment_failed',
              data: {
                object: {
                  id: `pi_fail_nofam_${Date.now()}`,
                  metadata: { organizationId: ctx.orgId, familyId: bogusFamily },
                },
              },
            }),
          )
        ).status,
      ).toBe(200)

      await Task.deleteMany({ notes: { $regex: piId } })
    })
  })
})
