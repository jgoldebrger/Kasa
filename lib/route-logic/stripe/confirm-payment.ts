import { NextResponse } from 'next/server'
import { handler } from '@/lib/api/handler'
import {
  Payment,
  SavedPaymentMethod,
  RecurringPayment,
  Family,
  FamilyMember,
  Organization,
} from '@/lib/models'
import { createPaymentDeclinedTask } from '@/lib/task-helpers'
import { audit } from '@/lib/audit'
import { fromMinorUnits } from '@/lib/money'
import { PAYMENT_PUBLIC_SELECT, serializePaymentPublic } from '@/lib/payments/select'
import { checkRateLimit } from '@/lib/rate-limit'
import { enforceMemberChargeGate } from '@/lib/billing/feature-gate'
import { addMonthsClamped, getYearInTimeZone } from '@/lib/date-utils'
import { scheduleYearlyCalculationRefresh } from '@/lib/calculations'
import { payment as paymentSchemas } from '@/lib/schemas'
import Stripe from 'stripe'
import https from 'https'

if (!process.env.STRIPE_SECRET_KEY) {
  console.error('STRIPE_SECRET_KEY is not set in environment variables')
}

const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.NODE_ENV === 'production',
})

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      httpAgent: httpsAgent,
    })
  : null

export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  body: paymentSchemas.confirmPaymentBody,
  name: 'POST /api/stripe/confirm-payment',
  fn: async ({ ctx, body, request }) => {
    if (!stripe) {
      return {
        status: 500,
        data: { error: 'Stripe is not configured. Please check server environment variables.' },
      }
    }

    const {
      paymentIntentId,
      familyId,
      paymentDate,
      year,
      type,
      notes,
      paymentFrequency,
      savedPaymentMethodId,
      memberId,
    } = body

    const rateVerdict = await checkRateLimit(
      request,
      'stripe-confirm',
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

    const fam = await Family.findOne({ _id: familyId, organizationId: ctx!.organizationId }).select(
      '_id',
    )
    if (!fam) {
      return NextResponse.json({ error: 'Family not found' }, { status: 404 })
    }

    // Tenant guard for memberId: when supplied, the member must belong
    // to the supplied family AND the caller's org. Without this check,
    // a caller could attribute a Stripe payment to a member of a
    // completely different family/tenant just by guessing an ObjectId.
    if (memberId) {
      const mem = await FamilyMember.findOne({
        _id: memberId,
        familyId,
        organizationId: ctx!.organizationId,
      }).select('_id')
      if (!mem) {
        return NextResponse.json({ error: 'Member not found in family' }, { status: 404 })
      }
    }

    // Idempotency: if a Payment row already exists for this PaymentIntent
    // in this org, return it as-is. Stops double-clicks and confirm-retry
    // loops from creating duplicate ledger entries.
    //
    // Must see soft-deleted rows: if an admin trashed the prior Payment,
    // the default filter hides it, the existence check misses, we fall
    // through to Payment.create — and the unique partial index (itself
    // excluding deletedAt:null rows) lets the duplicate insert succeed.
    // Net effect: every Stripe retry within the 30-day recycle-bin
    // window would resurrect a Payment the admin had just trashed.
    const existing = await Payment.findOne(
      {
        organizationId: ctx!.organizationId,
        stripePaymentIntentId: paymentIntentId,
      },
      null,
      { includeDeleted: true },
    )
    if (existing) {
      const pub = await Payment.findOne({
        _id: existing._id,
        organizationId: ctx!.organizationId,
      })
        .select(PAYMENT_PUBLIC_SELECT)
        .lean()
      return NextResponse.json({
        success: true,
        payment: pub ? serializePaymentPublic(pub) : { _id: existing._id },
        recurringPaymentId: existing.recurringPaymentId?.toString(),
        deduplicated: true,
      })
    }

    // Cross-tenant guard: the per-org unique index only stops dupes within
    // a single org. With a shared Stripe account, the *same* PaymentIntent
    // could otherwise be confirmed once per org. Reject if any other org
    // already booked this PI — they shouldn't share charges. Include
    // soft-deleted rows so trashing the original row in tenant A
    // doesn't quietly re-open the PI to tenant B.
    const otherOrgPayment = await Payment.findOne(
      {
        stripePaymentIntentId: paymentIntentId,
        organizationId: { $ne: ctx!.organizationId },
      },
      null,
      { includeDeleted: true },
    ).select('_id organizationId')
    if (otherOrgPayment) {
      console.warn('[stripe.confirm] cross-org PI reuse blocked', {
        paymentIntentId,
        attemptingOrg: String(ctx!.organizationId),
      })
      return NextResponse.json(
        { error: 'Payment intent is already associated with a different organization' },
        { status: 409 },
      )
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)

    // Ownership guard: the PaymentIntent's metadata must identify the
    // caller's org. Without this, an admin who knows any succeeded
    // `pi_…` ID (their own from another env, a colleague's, a leaked
    // ID, etc.) could ledger that charge under THIS org. The create-PI
    // route is responsible for stamping `metadata.organizationId` and
    // (when applicable) `metadata.familyId`.
    const piOrgId = paymentIntent.metadata?.organizationId
    if (!piOrgId || piOrgId !== String(ctx!.organizationId)) {
      console.warn('[stripe.confirm] PI metadata org missing or mismatch', {
        paymentIntentId,
        piOrgId,
        callerOrg: String(ctx!.organizationId),
      })
      return NextResponse.json(
        { error: 'Payment intent does not belong to this organization' },
        { status: 403 },
      )
    }
    if (familyId && paymentIntent.metadata?.familyId) {
      if (paymentIntent.metadata.familyId !== String(familyId)) {
        console.warn('[stripe.confirm] PI metadata family mismatch', {
          paymentIntentId,
          piFamilyId: paymentIntent.metadata.familyId,
          requestedFamilyId: String(familyId),
        })
        return NextResponse.json(
          { error: 'Payment intent does not belong to this family' },
          { status: 403 },
        )
      }
    }

    if (paymentIntent.status !== 'succeeded') {
      const internalMsg = `Payment not succeeded. Status: ${paymentIntent.status}`
      await createPaymentDeclinedTask(
        familyId,
        null,
        fromMinorUnits(paymentIntent.amount, paymentIntent.currency),
        internalMsg,
        ctx!.organizationId,
        memberId,
        paymentIntentId,
      )
      return NextResponse.json(
        {
          error: process.env.NODE_ENV === 'production' ? 'Payment was not completed' : internalMsg,
        },
        { status: 400 },
      )
    }

    let ccInfo: any = undefined
    let actualSavedPaymentMethodId = savedPaymentMethodId

    if (paymentIntent.payment_method) {
      const paymentMethod = await stripe.paymentMethods.retrieve(
        paymentIntent.payment_method as string,
      )

      if (paymentMethod.card) {
        ccInfo = {
          last4: paymentMethod.card.last4,
          cardType: paymentMethod.card.brand,
          expiryMonth: paymentMethod.card.exp_month?.toString(),
          expiryYear: paymentMethod.card.exp_year?.toString(),
          nameOnCard: paymentMethod.billing_details?.name || undefined,
        }

        if (savedPaymentMethodId === 'will_be_saved') {
          try {
            await SavedPaymentMethod.updateMany(
              { familyId: familyId, organizationId: ctx!.organizationId },
              { isDefault: false },
            )

            const saved = await SavedPaymentMethod.create({
              familyId: familyId,
              stripePaymentMethodId: paymentMethod.id,
              last4: paymentMethod.card.last4,
              cardType: paymentMethod.card.brand,
              expiryMonth: paymentMethod.card.exp_month || 0,
              expiryYear: paymentMethod.card.exp_year || 0,
              nameOnCard: paymentMethod.billing_details?.name || undefined,
              isDefault: true,
              isActive: true,
              organizationId: ctx!.organizationId,
            })
            actualSavedPaymentMethodId = saved._id.toString()
          } catch (err) {
            console.error('Error saving payment method:', err)
          }
        }
      }
    }

    if (actualSavedPaymentMethodId && actualSavedPaymentMethodId !== 'will_be_saved') {
      const spm = await SavedPaymentMethod.findOne({
        _id: actualSavedPaymentMethodId,
        familyId,
        organizationId: ctx!.organizationId,
      }).select('_id')
      if (!spm) {
        return NextResponse.json({ error: 'Saved payment method not found' }, { status: 404 })
      }
    }

    const effectivePaymentDate = paymentDate ? new Date(paymentDate) : new Date()
    // Stamp `year` from the effective payment date in the org's wall-clock
    // timezone. Two prior bugs this guards against:
    //   1) Backdated payments (admin records a Stripe charge with
    //      paymentDate in a prior membership year) were filed under the
    //      CURRENT year, breaking tax receipts and yearly income reports.
    //   2) A UTC tick that lands on Dec 31 21:30 in NY would otherwise
    //      file under the *new* year via getFullYear().
    let orgTz: string | undefined
    try {
      const org = await Organization.findById(ctx!.organizationId)
        .select('timezone')
        .lean<{ timezone?: string }>()
      orgTz = org?.timezone
    } catch {
      /* fall back to server-local year below */
    }
    const paymentData: any = {
      organizationId: ctx!.organizationId,
      familyId: familyId,
      // Use the PaymentIntent's currency so JPY/KRW/VND/CLP (zero
      // decimal) and other non-2-decimal currencies aren't silently
      // booked at 1/100th of the actual charge.
      amount: fromMinorUnits(paymentIntent.amount, paymentIntent.currency),
      paymentDate: effectivePaymentDate,
      year:
        year !== undefined && year !== null
          ? Number(year)
          : getYearInTimeZone(orgTz, effectivePaymentDate),
      type: type || 'membership',
      paymentMethod: 'credit_card',
      ccInfo: ccInfo,
      notes: notes || undefined,
      stripePaymentIntentId: paymentIntent.id,
      paymentFrequency: paymentFrequency || 'one-time',
      savedPaymentMethodId:
        actualSavedPaymentMethodId && actualSavedPaymentMethodId !== 'will_be_saved'
          ? actualSavedPaymentMethodId
          : undefined,
    }

    if (memberId) {
      paymentData.memberId = memberId
    }

    // Race-safe insert: on duplicate (Stripe retry that already created
    // the row in a parallel request), fall back to returning the existing
    // record. Requires the unique partial index on
    // (organizationId, stripePaymentIntentId) defined in lib/models.ts.
    let payment
    let createdNewPayment = false
    try {
      payment = await Payment.create(paymentData)
      createdNewPayment = true
    } catch (err: any) {
      if (err?.code === 11000) {
        payment = await Payment.findOne(
          {
            organizationId: ctx!.organizationId,
            stripePaymentIntentId: paymentIntent.id,
          },
          null,
          { includeDeleted: true },
        )
        if (!payment) throw err
      } else {
        throw err
      }
    }
    const paymentObj = await Payment.findOne({
      _id: payment!._id,
      organizationId: ctx!.organizationId,
    })
      .select(PAYMENT_PUBLIC_SELECT)
      .lean<{ amount: number } | null>()

    if (!paymentObj) {
      return NextResponse.json(
        { error: 'Payment record missing after confirmation' },
        { status: 500 },
      )
    }

    let recurringPaymentId: string | undefined
    if (paymentFrequency === 'monthly' && actualSavedPaymentMethodId) {
      const startDate = paymentDate ? new Date(paymentDate) : new Date()
      // Calendar-safe (Jan 31 → Feb 28, not Mar 3).
      const nextPaymentDate = addMonthsClamped(startDate, 1)

      const existingRecurring = await RecurringPayment.findOne({
        familyId: familyId,
        savedPaymentMethodId: actualSavedPaymentMethodId,
        isActive: true,
        organizationId: ctx!.organizationId,
      })

      if (existingRecurring) {
        existingRecurring.amount = paymentObj.amount
        existingRecurring.nextPaymentDate = nextPaymentDate
        existingRecurring.isActive = true
        await existingRecurring.save()
        recurringPaymentId = existingRecurring._id.toString()
      } else {
        const recurringPayment = await RecurringPayment.create({
          familyId: familyId,
          savedPaymentMethodId: actualSavedPaymentMethodId,
          amount: paymentObj.amount,
          frequency: 'monthly',
          startDate: startDate,
          nextPaymentDate: nextPaymentDate,
          isActive: true,
          notes: notes || `Monthly ${type || 'membership'} payment`,
          organizationId: ctx!.organizationId,
        })
        recurringPaymentId = recurringPayment._id.toString()
      }

      payment!.recurringPaymentId = recurringPaymentId as any
      await payment!.save()
    }

    if (createdNewPayment) {
      // Money in/out always wants an audit trail — "who confirmed
      // this Stripe charge and when?" is the question every dispute
      // workflow starts with.
      await audit({
        organizationId: ctx!.organizationId,
        userId: ctx!.userId,
        action: 'payment.create',
        resourceType: 'Payment',
        resourceId: payment!._id,
        metadata: {
          via: 'stripe.confirm',
          stripePaymentIntentId: paymentIntent.id,
          familyId: String(familyId || ''),
          amount: paymentObj.amount,
          recurringPaymentId,
          paymentFrequency,
        },
        request,
      })
      scheduleYearlyCalculationRefresh(paymentData.year, ctx!.organizationId)
    }

    return NextResponse.json({
      success: true,
      payment: serializePaymentPublic(paymentObj),
      recurringPaymentId: recurringPaymentId,
    })
  },
})
