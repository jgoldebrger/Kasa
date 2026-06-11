import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'

const stripeMocks = vi.hoisted(() => {
  const constructEvent = vi.fn((rawBody: string | Buffer) => {
    const text = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')
    return JSON.parse(text)
  })
  return { constructEvent }
})

vi.mock('stripe', () => ({
  default: vi.fn(function Stripe() {
    return {
      webhooks: { constructEvent: stripeMocks.constructEvent },
      charges: { retrieve: vi.fn() },
      paymentIntents: { create: vi.fn(), retrieve: vi.fn() },
    }
  }),
}))

import { NextRequest } from 'next/server'
import { Types } from 'mongoose'
import { setupMongo, teardownMongo } from '@/lib/test/mongo-memory'

describe('subscription webhook handlers (integration)', () => {
  const orgId = new Types.ObjectId()

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_billing'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
    process.env.STRIPE_PRICE_STARTER = 'price_starter_test'
    process.env.STRIPE_PRICE_COMMUNITY = 'price_community_test'
    await setupMongo()
  })

  afterAll(async () => {
    await teardownMongo()
  })

  afterEach(async () => {
    const { Organization, StripeWebhookEvent } = await import('@/lib/models')
    await Promise.all([
      StripeWebhookEvent.deleteMany({}),
      Organization.deleteMany({ _id: orgId }),
    ])
  })

  async function seedOrg(extra: Record<string, unknown> = {}) {
    const { Organization } = await import('@/lib/models')
    await Organization.create({
      _id: orgId,
      name: 'Sub Webhook Org',
      slug: `sub-wh-${orgId.toString().slice(-6)}`,
      ownerId: new Types.ObjectId(),
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

  it('syncs customer.subscription.updated onto the organization', async () => {
    await seedOrg()
    const { POST } = await import('@/lib/route-logic/stripe/webhook')
    const res = await POST(
      webhookRequest({
        id: `evt_sub_upd_${Date.now()}`,
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_live_1',
            customer: 'cus_live_1',
            status: 'active',
            metadata: { organizationId: orgId.toString(), planTier: 'community' },
            items: {
              data: [
                {
                  price: { id: 'price_community_test' },
                  current_period_end: Math.floor(new Date('2026-08-01').getTime() / 1000),
                },
              ],
            },
            trial_end: null,
          },
        },
      }),
    )
    expect(res.status).toBe(200)

    const { Organization } = await import('@/lib/models')
    const org = await Organization.findById(orgId).lean<any>()
    expect(org.subscriptionId).toBe('sub_live_1')
    expect(org.stripeCustomerId).toBe('cus_live_1')
    expect(org.planTier).toBe('community')
    expect(org.subscriptionStatus).toBe('active')
    expect(org.currentPeriodEnd).toBeInstanceOf(Date)
  })

  it('seeds stripeCustomerId on checkout.session.completed', async () => {
    await seedOrg()
    const { POST } = await import('@/lib/route-logic/stripe/webhook')
    const res = await POST(
      webhookRequest({
        id: `evt_chk_${Date.now()}`,
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_1',
            customer: 'cus_chk_1',
            subscription: 'sub_chk_1',
            metadata: {
              organizationId: orgId.toString(),
              planTier: 'starter',
            },
          },
        },
      }),
    )
    expect(res.status).toBe(200)

    const { Organization } = await import('@/lib/models')
    const org = await Organization.findById(orgId).lean<any>()
    expect(org.stripeCustomerId).toBe('cus_chk_1')
    expect(org.subscriptionId).toBe('sub_chk_1')
    expect(org.planTier).toBe('starter')
  })

  it('marks subscription canceled on customer.subscription.deleted', async () => {
    await seedOrg({
      stripeCustomerId: 'cus_del_1',
      subscriptionId: 'sub_del_1',
      planTier: 'starter',
      subscriptionStatus: 'active',
    })
    const { POST } = await import('@/lib/route-logic/stripe/webhook')
    const res = await POST(
      webhookRequest({
        id: `evt_sub_del_${Date.now()}`,
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_del_1',
            customer: 'cus_del_1',
            status: 'canceled',
            metadata: { organizationId: orgId.toString() },
            items: {
              data: [
                {
                  price: { id: 'price_starter_test' },
                  current_period_end: Math.floor(new Date('2026-08-01').getTime() / 1000),
                },
              ],
            },
            trial_end: null,
          },
        },
      }),
    )
    expect(res.status).toBe(200)

    const { Organization } = await import('@/lib/models')
    const org = await Organization.findById(orgId).lean<any>()
    expect(org.subscriptionStatus).toBe('canceled')
    expect(org.planTier).toBe('starter')
  })
})
