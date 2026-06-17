import { NextResponse } from 'next/server'
import { handler } from '@/lib/api/handler'
import { Family, RecurringPayment } from '@/lib/models'
import { buildIdempotencyKey, resolveStripeCurrency, toMinorUnits } from '@/lib/money'
import { getOrgCurrency } from '@/lib/money.server'
import { sanitizeStripeErrorMessage } from '@/lib/payments/sanitize'
import { enforceMemberChargeGate } from '@/lib/billing/feature-gate'
import { checkRateLimit } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { payment as paymentSchemas } from '@/lib/schemas'
import Stripe from 'stripe'
import https from 'https'

if (!process.env.STRIPE_SECRET_KEY) {
  console.error('STRIPE_SECRET_KEY is not set in environment variables')
}

const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.NODE_ENV === 'production',
})

let stripe: Stripe | null = null

if (process.env.STRIPE_SECRET_KEY) {
  try {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      maxNetworkRetries: 2,
      timeout: 30000,
      httpAgent: httpsAgent,
    })
  } catch (error) {
    /* v8 ignore next — Stripe SDK constructor failure; suite uses a hoisted mock that cannot throw here */
    console.error('Failed to initialize Stripe:', error)
  }
}

export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  body: paymentSchemas.createPaymentIntentBody,
  name: 'POST /api/stripe/create-payment-intent',
  fn: async ({ ctx, body, request }) => {
    if (!stripe) {
      return NextResponse.json(
        {
          error:
            'Stripe is not configured. Please check server environment variables and restart the server.',
        },
        { status: 500 },
      )
    }

    const rateVerdict = await checkRateLimit(
      request,
      'stripe-create-pi',
      {
        limit: 30,
        windowMs: 60_000,
      },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const billingGate = await enforceMemberChargeGate(ctx!.organizationId)
    if (!billingGate.ok) {
      return NextResponse.json({ error: billingGate.error }, { status: billingGate.status })
    }

    const { amount, familyId, description, idempotencyHint } = body

    const fam = await Family.findOne({ _id: familyId, organizationId: ctx!.organizationId }).select(
      '_id',
    )
    if (!fam) {
      return NextResponse.json({ error: 'Family not found' }, { status: 404 })
    }

    const orgCurrency = await getOrgCurrency(ctx!.organizationId)
    const stripeCurrency = resolveStripeCurrency(orgCurrency)

    const idempotencyKey = buildIdempotencyKey([
      'pi-create',
      ctx!.organizationId,
      familyId,
      stripeCurrency,
      toMinorUnits(amount, orgCurrency),
      idempotencyHint || new Date().toISOString().slice(0, 19),
    ])

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: toMinorUnits(amount, orgCurrency),
        currency: stripeCurrency,
        description: description || `Payment for family ${familyId}`,
        metadata: {
          familyId: familyId || '',
          organizationId: ctx!.organizationId,
        },
        automatic_payment_methods: {
          enabled: true,
        },
      },
      { idempotencyKey },
    )

    // Audit trail for every admin-initiated PI. The amount comes from
    // the request body (not derived server-side from a plan), so the
    // audit row + ratio-vs-recurring-amount flag below give post-hoc
    // visibility into any unusual charge. `ratioVsRecurring` > ~1.05
    // or < ~0.95 deserves a closer look.
    let ratioVsRecurring: number | null = null
    try {
      const rec = await RecurringPayment.findOne({
        familyId,
        organizationId: ctx!.organizationId,
        isActive: true,
      })
        .select('amount')
        .lean<{ amount?: number }>()
      const expected = Number(rec?.amount || 0)
      if (expected > 0) {
        ratioVsRecurring = Number((amount / expected).toFixed(3))
      }
    } catch {
      /* lookup is best-effort */
    }
    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'stripe.payment_intent.create',
      resourceType: 'PaymentIntent',
      resourceId: paymentIntent.id,
      metadata: {
        familyId,
        amount,
        currency: stripeCurrency,
        ratioVsRecurring,
        description: (description || '').slice(0, 200),
      },
      request,
    }).catch(() => {
      // Audit must not block the response — we've already created the
      // PI in Stripe. Logging the audit miss is enough.
    })

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      currency: stripeCurrency,
    })
  },
})
