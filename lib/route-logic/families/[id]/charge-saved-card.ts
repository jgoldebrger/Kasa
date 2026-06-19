import { Types } from 'mongoose'
import { handler } from '@/lib/api/handler'
import {
  SavedPaymentMethod,
  Payment,
  Family,
  FamilyMember,
  RecurringPayment,
  Organization,
} from '@/lib/models'
import { createPaymentDeclinedTask } from '@/lib/task-helpers'
import { buildIdempotencyKey, resolveStripeCurrency, toMinorUnits } from '@/lib/money'
import { getOrgCurrency } from '@/lib/money.server'
import { addMonthsClamped, getYearInTimeZone } from '@/lib/date-utils'
import { audit } from '@/lib/audit'
import { checkRateLimit } from '@/lib/rate-limit'
import { PAYMENT_PUBLIC_SELECT, serializePaymentPublic } from '@/lib/payments/select'
import { sanitizeStripeErrorMessage } from '@/lib/payments/sanitize'
import { enforceMemberChargeGate } from '@/lib/billing/feature-gate'
import { payment as paymentSchemas } from '@/lib/schemas'
import { scheduleYearlyCalculationRefresh } from '@/lib/calculations'
import Stripe from 'stripe'
import https from 'https'

const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.NODE_ENV === 'production',
})

function getStripe() {
  const apiKey = process.env.STRIPE_SECRET_KEY
  if (!apiKey) {
    throw new Error('STRIPE_SECRET_KEY is not configured')
  }
  return new Stripe(apiKey, {
    apiVersion: '2025-10-29.clover',
    httpAgent: httpsAgent,
  })
}

const MAX_CHARGE = 100_000

// POST - Charge a saved payment method
export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  body: paymentSchemas.chargeSavedCardBody,
  name: 'POST /api/families/[id]/charge-saved-card',
  fn: async ({ params, ctx, body, request }) => {
    const id = params.id as string
    let amount: number = 0
    let memberId: string | undefined = undefined
    let stripePaymentIntentIdForCatch: string | undefined

    const rateVerdict = await checkRateLimit(
      request,
      'charge-saved-card',
      { limit: 30, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const billingGate = await enforceMemberChargeGate(ctx!.organizationId)
    if (!billingGate.ok) {
      return { status: billingGate.status, data: { error: billingGate.error } }
    }

    try {
      const {
        savedPaymentMethodId,
        amount: bodyAmount,
        paymentDate,
        year,
        type,
        notes,
        memberId: bodyMemberId,
        paymentFrequency,
      } = body
      amount = bodyAmount
      memberId = bodyMemberId

      if (amount > MAX_CHARGE) {
        return {
          status: 400,
          data: { error: `Amount exceeds maximum of ${MAX_CHARGE.toLocaleString()}` },
        }
      }

      const parentFamily = await Family.findOne({
        _id: id,
        organizationId: ctx!.organizationId,
      }).select('_id')
      if (!parentFamily) {
        return { status: 404, data: { error: 'Family not found' } }
      }

      const savedPaymentMethod = await SavedPaymentMethod.findOne({
        _id: savedPaymentMethodId,
        organizationId: ctx!.organizationId,
      })

      if (!savedPaymentMethod || savedPaymentMethod.familyId.toString() !== id) {
        return { status: 404, data: { error: 'Saved payment method not found' } }
      }

      // Tenant guard for memberId: must point at a member of THIS family
      // in THIS org. Without this check, an admin could attribute the
      // ledger row to a member belonging to a different family / tenant.
      if (memberId) {
        /* v8 ignore next 2 — chargeSavedCardBody validates memberId as objectId before fn runs */
        if (!Types.ObjectId.isValid(memberId)) {
          return { status: 400, data: { error: 'Invalid memberId' } }
        }
        const mem = await FamilyMember.findOne({
          _id: memberId,
          familyId: id,
          organizationId: ctx!.organizationId,
        }).select('_id')
        if (!mem) {
          return { status: 404, data: { error: 'Member not found in family' } }
        }
      }

      const orgCurrency = await getOrgCurrency(ctx!.organizationId)
      const stripeCurrency = resolveStripeCurrency(orgCurrency)
      const amountMinor = toMinorUnits(amount, orgCurrency)

      // Stable idempotency key per logical charge — same key returns the
      // existing PaymentIntent rather than creating a new one. The date
      // segment is rounded to the minute so a literal double-click still
      // collapses to a single charge.
      const dayBucket = (paymentDate ? new Date(paymentDate) : new Date())
        .toISOString()
        .slice(0, 16)
      const idempotencyKey = buildIdempotencyKey([
        'pi-saved-card',
        ctx!.organizationId,
        id,
        savedPaymentMethodId,
        amountMinor,
        stripeCurrency,
        dayBucket,
      ])

      const stripe = getStripe()
      const paymentIntent = await stripe.paymentIntents.create(
        {
          amount: amountMinor,
          currency: stripeCurrency,
          payment_method: savedPaymentMethod.stripePaymentMethodId,
          confirm: true,
          // Admin-initiated charge against a card on file — no customer
          // interaction. Marking it `off_session: true` lets Stripe
          // signal SCA exemption properly. If SCA is still required,
          // the PaymentIntent comes back as `requires_action` and the
          // route correctly classifies that as a failure (admin then
          // contacts the family to re-authenticate the card).
          off_session: true,
          description: `${type || 'membership'} payment for family ${id}`,
          metadata: {
            familyId: id,
            organizationId: ctx!.organizationId,
            savedPaymentMethodId: savedPaymentMethodId,
          },
        },
        { idempotencyKey },
      )
      stripePaymentIntentIdForCatch = paymentIntent.id

      if (paymentIntent.status !== 'succeeded') {
        const internalMsg = `Payment failed. Status: ${paymentIntent.status}`
        await createPaymentDeclinedTask(
          id,
          null,
          amount,
          internalMsg,
          ctx!.organizationId,
          memberId,
          paymentIntent.id,
        )
        return {
          status: 400,
          data: {
            error:
              process.env.NODE_ENV === 'production' ? 'Payment was not completed' : internalMsg,
          },
        }
      }

      // Idempotent ledger insert: if we already booked this PaymentIntent
      // (Stripe retried the request, or a parallel call won the race),
      // return the existing Payment row instead of duplicating it.
      const existing = await Payment.findOne(
        {
          organizationId: ctx!.organizationId,
          stripePaymentIntentId: paymentIntent.id,
        },
        null,
        { includeDeleted: true },
      )
      if (existing) {
        // Re-audit the deduplicated call so the admin's repeat click is
        // recorded — without this row the audit log silently drops every
        // duplicate-charge attempt and "who hit this button at 14:03?"
        // becomes unanswerable.
        await audit({
          organizationId: ctx!.organizationId,
          userId: ctx!.userId,
          action: 'payment.charge_saved_card.deduplicated',
          resourceType: 'Payment',
          resourceId: existing._id,
          metadata: {
            familyId: id,
            amount,
            stripePaymentIntentId: paymentIntent.id,
          },
          request,
        })
        return {
          data: {
            success: true,
            payment: serializePaymentPublic(
              (await Payment.findOne({
                _id: existing._id,
                organizationId: ctx!.organizationId,
              })
                .select(PAYMENT_PUBLIC_SELECT)
                .lean())!,
            ),
            recurringPaymentId: existing.recurringPaymentId?.toString(),
            deduplicated: true,
          },
        }
      }

      const effectivePaymentDate = paymentDate ? new Date(paymentDate) : new Date()
      // Derive `year` from the effective payment date in the org's wall-clock
      // timezone. Without this, a backdated charge (paymentDate in a prior
      // membership year) gets filed under the CURRENT year, which corrupts
      // tax receipts and yearly income reports.
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
        familyId: id,
        amount: amount,
        paymentDate: effectivePaymentDate,
        year: year ?? getYearInTimeZone(orgTz, effectivePaymentDate),
        type: type || 'membership',
        paymentMethod: 'credit_card',
        ccInfo: {
          last4: savedPaymentMethod.last4,
          cardType: savedPaymentMethod.cardType,
          expiryMonth: savedPaymentMethod.expiryMonth.toString(),
          expiryYear: savedPaymentMethod.expiryYear.toString(),
          nameOnCard: savedPaymentMethod.nameOnCard || undefined,
        },
        stripePaymentIntentId: paymentIntent.id,
        savedPaymentMethodId: savedPaymentMethodId,
        paymentFrequency: 'one-time',
        notes: notes || undefined,
      }

      if (memberId) {
        paymentData.memberId = memberId
      }

      let payment
      let ledgerWriteFailed = false
      let ledgerWriteError: any = null
      try {
        payment = await Payment.create(paymentData)
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
          if (!payment) {
            // Unique-index collision but no surviving row — bail out as
            // a ledger write failure so we don't mis-label the card as
            // declined.
            ledgerWriteFailed = true
            ledgerWriteError = err
          }
        } else {
          // Non-duplicate write failure AFTER a successful Stripe charge.
          // The previous code re-threw to the outer catch, which then
          // created a "Card declined" admin task — except the card was
          // NOT declined, it was charged successfully. That misled
          // admins into thinking the family's card was bad and made
          // every transient Mongo blip look like a billing issue.
          // Same fix as the recurring-payments cron route.
          ledgerWriteFailed = true
          ledgerWriteError = err
        }
      }

      if (ledgerWriteFailed) {
        console.error('[charge-saved-card] ledger write failed after successful Stripe charge', {
          familyId: id,
          paymentIntentId: paymentIntent.id,
          err: ledgerWriteError?.message,
        })
        // Audit the partial success so the admin / ops can reconcile —
        // the Stripe charge IS booked at the processor, just not in our
        // DB. The webhook backstop normally creates the row from
        // `payment_intent.succeeded`, but we still surface a 500 here.
        await audit({
          organizationId: ctx!.organizationId,
          userId: ctx!.userId,
          action: 'payment.charge_saved_card.ledger_failed',
          resourceType: 'Payment',
          metadata: {
            familyId: id,
            amount,
            stripePaymentIntentId: paymentIntent.id,
            error: ledgerWriteError?.message,
          },
          request,
        })
        return {
          status: 500,
          data: {
            error:
              'Stripe charge succeeded but the ledger write failed. The Stripe webhook will create the payment record, or contact support if it does not appear within a minute.',
          },
        }
      }

      const paymentObj = await Payment.findOne({
        _id: payment!._id,
        organizationId: ctx!.organizationId,
      })
        .select(PAYMENT_PUBLIC_SELECT)
        .lean()

      let recurringPaymentId: string | undefined
      let recurringWasCreated = false
      if (paymentFrequency === 'monthly') {
        const startDate = paymentDate ? new Date(paymentDate) : new Date()
        const nextPaymentDate = addMonthsClamped(startDate, 1)

        const existingRecurring = await RecurringPayment.findOne({
          familyId: id,
          savedPaymentMethodId: savedPaymentMethodId,
          isActive: true,
          organizationId: ctx!.organizationId,
        })

        if (existingRecurring) {
          existingRecurring.amount = amount
          existingRecurring.nextPaymentDate = nextPaymentDate
          existingRecurring.isActive = true
          await existingRecurring.save()
          recurringPaymentId = existingRecurring._id.toString()
        } else {
          const recurringPayment = await RecurringPayment.create({
            familyId: id,
            savedPaymentMethodId: savedPaymentMethodId,
            amount: amount,
            frequency: 'monthly',
            startDate: startDate,
            nextPaymentDate: nextPaymentDate,
            isActive: true,
            notes: notes || `Monthly ${type || 'membership'} payment`,
            organizationId: ctx!.organizationId,
          })
          recurringPaymentId = recurringPayment._id.toString()
          recurringWasCreated = true
        }

        payment!.recurringPaymentId = recurringPaymentId as any
        await payment!.save()
      }

      // Compute amount-vs-expected ratio for the audit row. The amount on
      // this endpoint comes from the request body (admin-entered), so a
      // post-hoc audit dashboard wants to flag charges that diverge
      // unusually far from the family's configured recurring amount.
      // `null` when there's no active recurring payment to compare to.
      let ratioVsRecurring: number | null = null
      try {
        const benchmark = recurringPaymentId
          ? await RecurringPayment.findById(recurringPaymentId)
              .select('amount')
              .lean<{ amount?: number }>()
          : await RecurringPayment.findOne({
              familyId: id,
              organizationId: ctx!.organizationId,
              isActive: true,
            })
              .select('amount')
              .lean<{ amount?: number }>()
        const expected = Number(benchmark?.amount || 0)
        if (expected > 0) ratioVsRecurring = Number((amount / expected).toFixed(3))
      } catch {
        /* best effort */
      }

      // Audit AFTER the ledger write so the row only appears for charges
      // that actually landed in our DB. Includes the recurring-payment
      // link when applicable so "who set up this monthly debit?" is
      // answerable.
      await audit({
        organizationId: ctx!.organizationId,
        userId: ctx!.userId,
        action: 'payment.charge_saved_card',
        resourceType: 'Payment',
        resourceId: payment!._id,
        metadata: {
          familyId: id,
          memberId: memberId || undefined,
          amount,
          ratioVsRecurring,
          type: paymentData.type,
          year: paymentData.year,
          stripePaymentIntentId: paymentIntent.id,
          savedPaymentMethodId,
          recurring: paymentFrequency === 'monthly',
          recurringPaymentId,
          recurringWasCreated,
        },
        request,
      })

      scheduleYearlyCalculationRefresh(paymentData.year, ctx!.organizationId)

      return {
        data: {
          success: true,
          payment: serializePaymentPublic(paymentObj!),
          recurringPaymentId: recurringPaymentId,
        },
      }
    } catch (error: any) {
      console.error('Error charging saved card:', error)

      try {
        await createPaymentDeclinedTask(
          id,
          null,
          amount || 0,
          sanitizeStripeErrorMessage(error.message) || 'Unknown error',
          ctx!.organizationId,
          memberId,
          stripePaymentIntentIdForCatch,
        )
      } catch (taskError) {
        console.error('Error creating task for declined payment:', taskError)
      }

      return {
        status: 500,
        data: {
          error: 'Failed to charge saved card',
          ...(process.env.NODE_ENV !== 'production' && {
            details: sanitizeStripeErrorMessage(error?.message),
          }),
        },
      }
    }
  },
})
