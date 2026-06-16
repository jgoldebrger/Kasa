import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import https from 'https'
import connectDB from '@/lib/database'
import { Payment, Task, Family, Organization, StripeWebhookEvent } from '@/lib/models'
import { audit } from '@/lib/audit'
import { logError } from '@/lib/log'
import { notifyAdmins } from '@/lib/notify'
import { fromMinorUnits, netPaymentAmount } from '@/lib/money'
import { getOrgMoneyContext } from '@/lib/money.server'
import { formatMoney } from '@/lib/currency'
import { getYearInTimeZone } from '@/lib/date-utils'
import {
  scheduleYearlyCalculationRefresh,
  scheduleYearlyCalculationRefreshForPayment,
} from '@/lib/calculations'
import {
  handleCheckoutSessionCompleted,
  syncSubscriptionToOrganization,
} from '@/lib/billing/subscription-webhook'

// Stripe webhook event retention: how long after we first process an
// event.id we keep the dedup record. Stripe retries for up to ~3 days
// on non-2xx; 7 days gives plenty of safety margin.
const DEDUP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Stripe webhook receiver.
 *
 * Subscribed events (configure on the Stripe dashboard, copy
 * `whsec_…` into `STRIPE_WEBHOOK_SECRET`):
 *
 *   - `charge.refunded`         → stamp Payment.refundedAt / refundedAmount
 *   - `charge.dispute.created`  → stamp Payment.disputedAt + open a Task
 *   - `charge.dispute.closed`   → update Payment.disputeStatus
 *   - `payment_intent.payment_failed` → open a Task so admins can chase
 *   - `checkout.session.completed`      → seed org stripeCustomerId
 *   - `customer.subscription.*`         → sync org planTier / status
 *
 * The body MUST be read as a raw buffer (not parsed JSON) for signature
 * verification, hence the manual `request.text()` + utf-8 conversion.
 *
 * Returns 200 even when we can't find the Payment row — we don't want
 * Stripe to retry forever on receipts created outside Kasa.
 */

const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.NODE_ENV === 'production',
})

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      httpAgent: httpsAgent,
      maxNetworkRetries: 2,
      timeout: 30000,
    })
  : null

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET

async function formatOrgMoney(organizationId: string, amount: number): Promise<string> {
  const moneyCtx = await getOrgMoneyContext(String(organizationId))
  return formatMoney(amount, moneyCtx)
}

export async function POST(request: NextRequest) {
  if (!stripe || !WEBHOOK_SECRET) {
    console.error('[stripe/webhook] Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET')
    return NextResponse.json({ error: 'Stripe webhook not configured' }, { status: 503 })
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  const rawBody = await request.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, WEBHOOK_SECRET)
  } catch (err: any) {
    console.warn('[stripe/webhook] Invalid signature:', err?.message)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  try {
    await connectDB()

    // Idempotency: Stripe webhook delivery is at-least-once. Without
    // dedup, retries re-create admin Tasks (`charge.dispute.created`)
    // and re-fire admin notifications. The dedup record is created
    // atomically — only the first delivery for an event.id proceeds
    // into the switch; subsequent ones return 200 immediately.
    try {
      await StripeWebhookEvent.create({
        eventId: event.id,
        type: event.type,
        processedAt: new Date(),
        expiresAt: new Date(Date.now() + DEDUP_RETENTION_MS),
      })
    } catch (err: any) {
      if (err?.code === 11000) {
        // Duplicate delivery — already processed.
        return NextResponse.json({ received: true, deduplicated: true })
      }
      throw err
    }

    switch (event.type) {
      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge
        await handleChargeRefunded(charge)
        break
      }
      case 'charge.dispute.created': {
        const dispute = event.data.object as Stripe.Dispute
        await handleDisputeCreated(dispute)
        break
      }
      case 'charge.dispute.closed': {
        const dispute = event.data.object as Stripe.Dispute
        await handleDisputeClosed(dispute)
        break
      }
      case 'payment_intent.succeeded': {
        const intent = event.data.object as Stripe.PaymentIntent
        await handlePaymentIntentSucceeded(intent)
        break
      }
      case 'payment_intent.payment_failed': {
        const intent = event.data.object as Stripe.PaymentIntent
        await handlePaymentIntentFailed(intent)
        break
      }
      case 'payment_intent.canceled': {
        const intent = event.data.object as Stripe.PaymentIntent
        await handlePaymentIntentCanceled(intent)
        break
      }
      case 'charge.dispute.funds_withdrawn': {
        const dispute = event.data.object as Stripe.Dispute
        await handleDisputeFundsWithdrawn(dispute)
        break
      }
      case 'charge.dispute.funds_reinstated': {
        const dispute = event.data.object as Stripe.Dispute
        await handleDisputeFundsReinstated(dispute)
        break
      }
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        await handleCheckoutSessionCompleted(session)
        break
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        await syncSubscriptionToOrganization(subscription)
        break
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        await syncSubscriptionToOrganization(subscription)
        break
      }
      default:
        // Quietly ack everything else — we only subscribe to what we
        // need, but Stripe sometimes delivers others (e.g. ping).
        break
    }

    return NextResponse.json({ received: true })
  } catch (err: any) {
    logError(err, { module: 'stripe/webhook', eventType: event.type })
    // Clear the dedup record so Stripe's retry can re-attempt. Without
    // this, a transient Mongo blip during the handler would leave the
    // dedup row in place, every retry would short-circuit on the 11000
    // path, and the event would be permanently lost.
    await StripeWebhookEvent.deleteOne({ eventId: event.id }).catch(() => {})
    // 5xx so Stripe retries (network blips, transient DB errors, etc.).
    // We previously swallowed errors with a 200 here — that meant a
    // refund webhook hitting a brief Mongo outage was lost forever
    // even though Stripe was willing to retry. Sentry still captures
    // the underlying error for human follow-up.
    return NextResponse.json(
      { received: false, error: 'handler-error' },
      { status: 500 },
    )
  }
}

async function handleChargeRefunded(charge: Stripe.Charge) {
  const paymentIntentId =
    typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id
  if (!paymentIntentId) return

  // Look through soft-deleted Payment rows too. If an admin trashed
  // the Payment between when the card was charged and when the refund
  // arrived, the soft-delete plugin's default filter would hide the
  // row and the refund would silently vanish — then a restore from
  // the bin would resurrect a Payment with `refundedAmount: 0` even
  // though Stripe has fully refunded it. The compound unique partial
  // index excludes deletedAt:null rows, so it's safe to find a
  // soft-deleted row by PI alone.
  const payment = await Payment.findOne(
    { stripePaymentIntentId: paymentIntentId },
    null,
    { includeDeleted: true },
  )
  if (!payment) return

  // `amount_refunded` is cumulative for the charge. Only update
  // `refundedAt` when the refunded total has actually INCREASED — every
  // webhook retry would otherwise re-stamp `refundedAt = now`, breaking
  // the "when was this refund issued?" answer. (Stripe historically
  // delivers `charge.refunded` once per refund, but retries on non-2xx,
  // and you can also receive it on partial-refund increases.)
  //
  // Use `fromMinorUnits(charge.currency)` instead of bare `/100`:
  // JPY-style zero-decimal currencies use the raw integer, so dividing
  // a ¥1,000 refund by 100 would have silently recorded a ¥10 refund.
  const refundedMinor = charge.amount_refunded || 0
  const newRefunded = fromMinorUnits(refundedMinor, charge.currency || 'usd')
  const previousRefunded = Number(payment.refundedAmount || 0)
  if (newRefunded <= previousRefunded) {
    // Idempotent re-delivery — no observable change. Keep the original
    // refundedAt timestamp.
    return
  }
  payment.refundedAt = new Date()
  payment.refundedAmount = newRefunded
  await payment.save()
  scheduleYearlyCalculationRefreshForPayment(payment)

  await audit({
    organizationId: payment.organizationId?.toString(),
    action: 'payment.refunded',
    resourceType: 'Payment',
    resourceId: payment._id,
    metadata: {
      stripeChargeId: charge.id,
      refundedAmount: payment.refundedAmount,
      originalAmount: payment.amount,
    },
  })
}

/** Reconcile `refundedAmount` against Stripe's cumulative charge refund total. */
async function syncPaymentRefundFromStripeCharge(
  payment: InstanceType<typeof Payment>,
  chargeId: string,
  disputeStatus?: string,
): Promise<void> {
  if (!stripe) return
  let charge: Stripe.Charge
  try {
    charge = await stripe.charges.retrieve(chargeId)
  } catch {
    return
  }
  const newRefunded = fromMinorUnits(charge.amount_refunded || 0, charge.currency || 'usd')
  const previousRefunded = Number(payment.refundedAmount || 0)
  if (newRefunded !== previousRefunded) {
    if (newRefunded > previousRefunded) {
      payment.refundedAt = new Date()
    } else if (newRefunded === 0) {
      payment.refundedAt = undefined
    }
    payment.refundedAmount = newRefunded
  }
  if (disputeStatus) {
    payment.disputeStatus = disputeStatus
  }
  await payment.save()
  scheduleYearlyCalculationRefreshForPayment(payment)
}

async function handleDisputeCreated(dispute: Stripe.Dispute) {
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id
  if (!chargeId || !stripe) return

  // Resolve charge → payment_intent so we can find our Payment row.
  let paymentIntentId: string | undefined
  try {
    const charge = await stripe.charges.retrieve(chargeId)
    paymentIntentId =
      typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id || undefined
  } catch {
    return
  }
  if (!paymentIntentId) return

  // Include soft-deleted payments — see comment in handleChargeRefunded.
  // A dispute against a trashed Payment must still be tracked.
  const payment = await Payment.findOne(
    { stripePaymentIntentId: paymentIntentId },
    null,
    { includeDeleted: true },
  )
  if (!payment) return

  payment.disputedAt = new Date()
  payment.disputeStatus = dispute.status || 'needs_response'
  await payment.save()

  const family = payment.familyId
    ? await Family.findOne({
        _id: payment.familyId,
        organizationId: payment.organizationId,
      }).lean<{ name?: string; email?: string }>()
    : null

  const disputeIdPattern = dispute.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const alreadyHandled = await Task.findOne({
    organizationId: payment.organizationId,
    notes: { $regex: disputeIdPattern },
  }).select('_id')
  if (alreadyHandled) return

  await Task.create({
    organizationId: payment.organizationId,
    title: `Card dispute opened: ${await formatOrgMoney(String(payment.organizationId), netPaymentAmount(payment))}`,
    description:
      `A chargeback was opened against ${family?.name || 'a family'} payment ` +
      `(${dispute.reason || 'unspecified reason'}). Review and respond before ` +
      `${dispute.evidence_details?.due_by ? new Date(dispute.evidence_details.due_by * 1000).toLocaleDateString() : 'the Stripe-set deadline'}.`,
    dueDate: dispute.evidence_details?.due_by
      ? new Date(dispute.evidence_details.due_by * 1000)
      : new Date(),
    email: family?.email || 'admin@kasa.com',
    status: 'pending',
    priority: 'high',
    relatedFamilyId: payment.familyId,
    relatedPaymentId: payment._id,
    notes: `Stripe dispute ${dispute.id}. Reason: ${dispute.reason}.`,
  })

  await audit({
    organizationId: payment.organizationId?.toString(),
    action: 'payment.disputed',
    resourceType: 'Payment',
    resourceId: payment._id,
    metadata: {
      disputeId: dispute.id,
      reason: dispute.reason,
      amount: netPaymentAmount(payment),
    },
  })

  await notifyAdmins(payment.organizationId, {
    kind: 'dispute.opened',
    title: `Card dispute: ${await formatOrgMoney(String(payment.organizationId), netPaymentAmount(payment))}`,
    body: `${family?.name || 'A family'} disputed a payment (${dispute.reason || 'unknown reason'}).`,
    link: '/tasks',
    metadata: { disputeId: dispute.id, paymentId: payment._id?.toString() },
  })
}

async function handleDisputeClosed(dispute: Stripe.Dispute) {
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id
  if (!chargeId || !stripe) return

  let paymentIntentId: string | undefined
  try {
    const charge = await stripe.charges.retrieve(chargeId)
    paymentIntentId =
      typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id || undefined
  } catch {
    return
  }
  if (!paymentIntentId) return

  const payment = await Payment.findOne(
    { stripePaymentIntentId: paymentIntentId },
    null,
    { includeDeleted: true },
  )
  if (!payment) return

  payment.disputeStatus = dispute.status || 'closed'

  // When a dispute is LOST, the cardholder wins the chargeback and the
  // funds are reversed permanently. Reflect this in the family balance
  // the same way we treat refunds — by stamping `refundedAmount` up to
  // (at least) the disputed amount. Without this, a lost chargeback
  // left the original `amount` fully credited to the family forever.
  // Won disputes (we keep the money) need no balance adjustment.
  //
  // Use `fromMinorUnits(dispute.currency)`: `dispute.amount` is in
  // minor units, so for JPY-style zero-decimal currencies dividing
  // by 100 records a lost chargeback at 1/100th of its real value.
  if (dispute.status === 'lost') {
    // Sync from Stripe's cumulative `amount_refunded` — `dispute.amount`
    // is only the disputed slice, so a prior partial refund plus a lost
    // chargeback would under-state `refundedAmount` if we stamped
    // `dispute.amount` alone.
    await syncPaymentRefundFromStripeCharge(payment, chargeId, dispute.status || 'lost')
    return
  } else if (dispute.status === 'won') {
    await syncPaymentRefundFromStripeCharge(payment, chargeId, dispute.status || 'won')
    return
  }
  await payment.save()
}

/**
 * `charge.dispute.funds_withdrawn` lands when Stripe pulls the disputed
 * funds back from your balance (typically right after dispute creation,
 * before the bank has decided). The "official" balance impact happens
 * here even if the dispute is later won and the funds are returned via
 * `funds_reinstated`. We mirror it into `refundedAmount` so the family
 * balance reflects reality in real time.
 */
async function handleDisputeFundsWithdrawn(dispute: Stripe.Dispute) {
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id
  if (!chargeId || !stripe) return

  let paymentIntentId: string | undefined
  try {
    const charge = await stripe.charges.retrieve(chargeId)
    paymentIntentId =
      typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id || undefined
  } catch {
    return
  }
  if (!paymentIntentId) return

  const payment = await Payment.findOne(
    { stripePaymentIntentId: paymentIntentId },
    null,
    { includeDeleted: true },
  )
  if (!payment) return

  await syncPaymentRefundFromStripeCharge(
    payment,
    chargeId,
    dispute.status || 'funds_withdrawn',
  )
}

/**
 * `charge.dispute.funds_reinstated` — Stripe returns disputed funds after
 * the merchant wins. Mirror the updated `charge.amount_refunded` so the
 * family balance stops reflecting a withdrawal that was reversed.
 */
async function handleDisputeFundsReinstated(dispute: Stripe.Dispute) {
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id
  if (!chargeId || !stripe) return

  let paymentIntentId: string | undefined
  try {
    const charge = await stripe.charges.retrieve(chargeId)
    paymentIntentId =
      typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id || undefined
  } catch {
    return
  }
  if (!paymentIntentId) return

  const payment = await Payment.findOne(
    { stripePaymentIntentId: paymentIntentId },
    null,
    { includeDeleted: true },
  )
  if (!payment) return

  await syncPaymentRefundFromStripeCharge(payment, chargeId, dispute.status || 'won')
}

/**
 * `payment_intent.canceled` — the PI was canceled (timeout, manual
 * cancel, etc.) before charging. We emit an admin task so it doesn't
 * disappear silently like `payment_intent.payment_failed`.
 */
async function handlePaymentIntentCanceled(intent: Stripe.PaymentIntent) {
  const familyId = intent.metadata?.familyId || null
  const organizationId = intent.metadata?.organizationId || null
  if (!familyId || !organizationId) return

  const alreadyHandled = await Task.findOne({
    organizationId,
    relatedFamilyId: familyId,
    notes: { $regex: intent.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') },
  }).select('_id')
  if (alreadyHandled) return

  const family = await Family.findOne({ _id: familyId, organizationId }).lean<{
    name?: string
    email?: string
  }>()
  if (!family) return

  const amountMajor = fromMinorUnits(intent.amount || 0, intent.currency || 'usd')
  const formattedAmount = await formatOrgMoney(organizationId, amountMajor)
  await Task.create({
    organizationId,
    title: `Payment intent canceled: ${formattedAmount}`,
    description:
      `A payment attempt was canceled for ${family.name || 'family'} ` +
      `before it completed. Reason: ${intent.cancellation_reason || 'unspecified'}.`,
    dueDate: new Date(),
    email: family.email || 'admin@kasa.com',
    status: 'pending',
    priority: 'medium',
    relatedFamilyId: familyId,
    notes: `Stripe PaymentIntent ${intent.id} canceled.`,
  })

  await notifyAdmins(organizationId, {
    kind: 'payment.canceled',
    title: `Payment canceled: ${family.name || 'family'}`,
    body: `Reason: ${intent.cancellation_reason || 'unspecified'}`,
    link: '/tasks',
    metadata: { paymentIntentId: intent.id, familyId },
  })
}

/**
 * Backstop ledger insert for any PaymentIntent that succeeded upstream
 * but never made it through `/api/stripe/confirm-payment` (network
 * failure, function timeout, browser crash). We only ever insert if
 * none of our routes have already booked the row — the unique partial
 * index on `(organizationId, stripePaymentIntentId)` lets us upsert
 * safely under contention.
 */
async function handlePaymentIntentSucceeded(intent: Stripe.PaymentIntent) {
  const familyId = intent.metadata?.familyId || null
  const organizationId = intent.metadata?.organizationId || null
  if (!familyId || !organizationId) return

  // Existence check must see soft-deleted rows too — if an admin
  // trashed the recovered Payment, we don't want the webhook to
  // backstop-recreate it on every Stripe retry within the 30-day
  // recycle-bin window. Without `includeDeleted`, the default filter
  // hides the row, we re-insert, and the unique partial index
  // (which itself excludes deletedAt:null) lets the insert succeed —
  // duplicating the ledger row the admin just deleted.
  const existing = await Payment.findOne(
    {
      organizationId,
      stripePaymentIntentId: intent.id,
    },
    null,
    { includeDeleted: true },
  ).lean<{ _id: any }>()
  if (existing) return

  const family = await Family.findOne({
    _id: familyId,
    organizationId,
  }).lean<{ _id: any }>()
  if (!family) return

  // Pin paymentDate to when Stripe actually charged the card, not when
  // this webhook happened to land. The two are usually within seconds,
  // but if the webhook is delayed across a year boundary (e.g. NYE
  // outage with retries flowing into January) booking the payment
  // under the wrong calendar year throws off the yearly-calculation
  // snapshot and the org's tax receipts for that family.
  const paidAt = typeof intent.created === 'number'
    ? new Date(intent.created * 1000)
    : new Date()

  // Derive `year` in the org's wall-clock timezone — same fix shape
  // as confirm-payment and charge-saved-card. Without this, a card
  // charged at 11:30 PM Dec 31 in NYC (04:30 UTC Jan 1) gets filed
  // under the wrong year on tax receipts and the annual snapshot.
  let orgTz: string | undefined
  try {
    const org = await Organization.findById(organizationId)
      .select('timezone')
      .lean<{ timezone?: string }>()
    orgTz = org?.timezone
  } catch {
    /* fall back to server-local year below */
  }

  // Convert Stripe minor units → KASA major units using the per-intent
  // currency, not a hard-coded /100. JPY/KRW/VND/CLP are
  // zero-decimal at Stripe and dividing by 100 silently records the
  // payment at 1/100th of its real value.
  const amountMajor = fromMinorUnits(intent.amount || 0, intent.currency || 'usd')
  const paymentYear = getYearInTimeZone(orgTz, paidAt)

  try {
    await Payment.create({
      organizationId,
      familyId,
      amount: amountMajor,
      paymentDate: paidAt,
      year: paymentYear,
      type: 'membership',
      paymentMethod: 'credit_card',
      stripePaymentIntentId: intent.id,
      paymentFrequency: 'one-time',
      notes: 'Recovered from Stripe webhook (confirm-payment did not complete)',
    })
    scheduleYearlyCalculationRefresh(paymentYear, organizationId)
  } catch (err: any) {
    // 11000 → another writer beat us to it. Ignore.
    if (err?.code !== 11000) throw err
  }
}

async function handlePaymentIntentFailed(intent: Stripe.PaymentIntent) {
  // Locate the family from intent.metadata if the upstream charge call
  // set it; otherwise we have no tenant context and skip silently.
  const familyId = (intent.metadata && intent.metadata.familyId) || null
  const organizationId = (intent.metadata && intent.metadata.organizationId) || null
  if (!familyId || !organizationId) return

  // confirm-payment / charge-saved-card / recurring cron already call
  // `createPaymentDeclinedTask`, which stamps the PI id into task notes.
  // Stripe also delivers `payment_intent.payment_failed` for the same
  // failure — skip the webhook path to avoid duplicate tasks + alerts.
  const piMarker = `Stripe PaymentIntent ${intent.id}`
  const alreadyHandled = await Task.findOne({
    organizationId,
    relatedFamilyId: familyId,
    notes: { $regex: intent.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') },
  }).select('_id')
  if (alreadyHandled) return

  const family = await Family.findOne({ _id: familyId, organizationId }).lean<{
    name?: string
    email?: string
  }>()
  if (!family) return

  const errMsg = intent.last_payment_error?.message || 'Card declined'
  const amountMajor = fromMinorUnits(intent.amount || 0, intent.currency || 'usd')
  const formattedAmount = await formatOrgMoney(organizationId, amountMajor)
  await Task.create({
    organizationId,
    title: `Recurring charge failed: ${formattedAmount}`,
    description:
      `Stripe could not charge ${family.name || 'family'}'s saved card. ` +
      `Reason: ${errMsg}.`,
    dueDate: new Date(),
    email: family.email || 'admin@kasa.com',
    status: 'pending',
    priority: 'high',
    relatedFamilyId: familyId,
    notes: `${piMarker}.`,
  })

  await notifyAdmins(organizationId, {
    kind: 'payment.failed',
    title: `Recurring charge failed: ${family.name || 'family'}`,
    body: errMsg,
    link: '/tasks',
    metadata: { paymentIntentId: intent.id, familyId },
  })
}

// Pin to the Node runtime; we use crypto + `request.text()` and the
// stripe SDK isn't edge-compatible.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
