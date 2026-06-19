import { Types } from 'mongoose'
import { handler } from '@/lib/api/handler'
import { Organization, RecurringPayment, Payment, Family, SavedPaymentMethod } from '@/lib/models'
import { UNBOUNDED_LIST_CAP } from '@/lib/schemas'
import { collectCompoundCursorPages } from '@/lib/pagination'
import { createPaymentDeclinedTask } from '@/lib/task-helpers'
import { sanitizeStripeErrorMessage } from '@/lib/payments/sanitize'
import { buildIdempotencyKey, resolveStripeCurrency, toMinorUnits } from '@/lib/money'
import { getOrgCurrency } from '@/lib/money.server'
import { addMonthsClamped, getYearInTimeZone, startOfDayInTimeZone } from '@/lib/date-utils'
import { checkRateLimit } from '@/lib/rate-limit'
import { enforceMemberChargeGate } from '@/lib/billing/feature-gate'
import { scheduleYearlyCalculationRefreshForPayment } from '@/lib/calculations'
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

// POST - Process all due recurring payments for one organization.
// Accepts an admin session OR a cron secret + ?organizationId=<id>.
export const POST = handler({
  auth: 'org-or-cron',
  minRole: 'admin',
  name: 'POST /api/recurring-payments/process',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'recurring-process',
      {
        limit: 5,
        windowMs: 60_000,
      },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const billingGate = await enforceMemberChargeGate(ctx!.organizationId)
    if (!billingGate.ok) {
      return { status: billingGate.status, data: { error: billingGate.error } }
    }

    const orgCurrency = await getOrgCurrency(ctx!.organizationId)
    const stripeCurrency = resolveStripeCurrency(orgCurrency)

    // Bound "today" to the org's wall clock so a 02:00 UTC cron tick
    // doesn't bill an Asia/Jerusalem org for tomorrow's recurring
    // payment overnight. Org `timezone` defaults to 'UTC'.
    const org = await Organization.findById(ctx!.organizationId)
      .select('timezone')
      .lean<{ timezone?: string }>()
    const today = startOfDayInTimeZone(org?.timezone)

    const results: any[] = []
    let processed = 0
    let failed = 0

    let afterId: Types.ObjectId | null = null
    for (;;) {
      const dueFilter: Record<string, unknown> = {
        isActive: true,
        nextPaymentDate: { $lte: today },
        organizationId: ctx!.organizationId,
      }
      if (afterId) dueFilter._id = { $gt: afterId }

      const duePayments = await RecurringPayment.find(dueFilter)
        .populate({
          path: 'familyId',
          select: 'name email organizationId',
          match: { organizationId: ctx!.organizationId },
          options: { includeDeleted: true },
        })
        .sort({ _id: 1 })
        .limit(UNBOUNDED_LIST_CAP)

      if (duePayments.length === 0) break

      for (const recurringPayment of duePayments) {
        let lastPaymentIntentId: string | undefined

        try {
          const family = recurringPayment.familyId as any

          if (!family || typeof family !== 'object' || !family._id || family.deletedAt) {
            results.push({
              recurringPaymentId: recurringPayment._id.toString(),
              familyName: family?.name || 'Unknown',
              status: 'failed',
              error: 'Family not found, deleted, or no longer in this organization',
            })
            failed++
            continue
          }

          const savedPaymentMethod = await SavedPaymentMethod.findOne({
            _id: recurringPayment.savedPaymentMethodId,
            organizationId: ctx!.organizationId,
            familyId: family._id,
            isActive: true,
          })

          if (!savedPaymentMethod) {
            results.push({
              recurringPaymentId: recurringPayment._id.toString(),
              familyName: family?.name || 'Unknown',
              status: 'failed',
              error: 'Saved payment method not found or inactive',
            })
            failed++
            continue
          }

          // Atomic "claim" of the next billing period. We pre-advance
          // `nextPaymentDate` before charging so a concurrent cron run
          // skips this row instead of double-charging. If the charge
          // later fails we roll the date back.
          const intendedNextDate = addMonthsClamped(recurringPayment.nextPaymentDate, 1)
          const claimedDate = recurringPayment.nextPaymentDate
          const claim = await RecurringPayment.updateOne(
            {
              _id: recurringPayment._id,
              organizationId: ctx!.organizationId,
              isActive: true,
              nextPaymentDate: claimedDate,
            },
            { $set: { nextPaymentDate: intendedNextDate } },
          )
          if (claim.modifiedCount !== 1) {
            // Another worker already claimed this billing period.
            continue
          }

          // Stable idempotency key keyed on (recurringPaymentId, billingPeriod).
          // If Stripe replays this request (network retry, our retry, etc.)
          // it returns the same PaymentIntent instead of double-charging.
          const billingPeriodKey = claimedDate.toISOString().slice(0, 10)
          const idempotencyKey = buildIdempotencyKey([
            'pi-recurring',
            ctx!.organizationId,
            recurringPayment._id.toString(),
            billingPeriodKey,
            toMinorUnits(recurringPayment.amount, orgCurrency),
            stripeCurrency,
          ])

          const stripe = getStripe()
          let paymentIntent: Stripe.PaymentIntent
          try {
            paymentIntent = await stripe.paymentIntents.create(
              {
                amount: toMinorUnits(recurringPayment.amount, orgCurrency),
                currency: stripeCurrency,
                payment_method: savedPaymentMethod.stripePaymentMethodId,
                confirm: true,
                // Mark as merchant-initiated, off-session charge so SCA
                // (Strong Customer Authentication, mandated in the EU
                // and increasingly enforced elsewhere) treats this as
                // an authorized recurring debit instead of a fresh
                // transaction requiring interactive auth. Without this,
                // a card that requires SCA returns `requires_action`
                // mid-charge — which we already classify as failure and
                // roll back, but the underlying problem is that we
                // never told Stripe this was an unattended charge.
                off_session: true,
                description: `Monthly recurring payment for ${family?.name || 'family'}`,
                metadata: {
                  familyId: family?._id?.toString() || '',
                  organizationId: ctx!.organizationId,
                  recurringPaymentId: recurringPayment._id.toString(),
                  billingPeriod: billingPeriodKey,
                },
              },
              { idempotencyKey },
            )
          } catch (chargeErr) {
            // Roll back our claim so the next cron tick can retry.
            await RecurringPayment.updateOne(
              { _id: recurringPayment._id, organizationId: ctx!.organizationId },
              { $set: { nextPaymentDate: claimedDate } },
            ).catch(() => {})
            throw chargeErr
          }
          lastPaymentIntentId = paymentIntent.id

          if (paymentIntent.status !== 'succeeded') {
            const errorMsg = `Payment failed. Status: ${paymentIntent.status}`
            // Roll back the claim — we want to retry on the next run.
            await RecurringPayment.updateOne(
              { _id: recurringPayment._id, organizationId: ctx!.organizationId },
              { $set: { nextPaymentDate: claimedDate } },
            ).catch(() => {})
            results.push({
              recurringPaymentId: recurringPayment._id.toString(),
              familyName: family?.name || 'Unknown',
              status: 'failed',
              error: errorMsg,
            })
            await createPaymentDeclinedTask(
              family?._id?.toString() || '',
              null,
              recurringPayment.amount,
              errorMsg,
              ctx!.organizationId,
              undefined,
              paymentIntent.id,
            )
            failed++
            continue
          }

          // Idempotent ledger write — never double-book the same PaymentIntent.
          //
          // SAFETY: if the ledger write fails for a non-duplicate reason
          // (Mongo blip, validation error, etc.) we MUST roll back the
          // pre-advanced `nextPaymentDate`. Without rollback, the
          // customer's card was charged but no Payment row exists and
          // the schedule is already advanced — they'd silently lose a
          // billing period of credit. The webhook backstop will also
          // eventually create the row, but rolling back the schedule
          // means the next cron tick will retry (idempotency key prevents
          // double-charge) and ensure both ledger and schedule converge.
          const existingPayment = await Payment.findOne(
            {
              organizationId: ctx!.organizationId,
              stripePaymentIntentId: paymentIntent.id,
            },
            null,
            { includeDeleted: true },
          )
          let payment = existingPayment
          if (!payment) {
            const paymentDate = new Date()
            try {
              payment = await Payment.create({
                organizationId: ctx!.organizationId,
                familyId: recurringPayment.familyId,
                amount: recurringPayment.amount,
                paymentDate: paymentDate,
                // Use the org's wall-clock year. A 00:30 UTC tick on Jan 1
                // in NY (= Dec 31 21:30 local) would otherwise file the
                // charge under the wrong fiscal year.
                year: getYearInTimeZone(org?.timezone, paymentDate),
                type: 'membership',
                paymentMethod: 'credit_card',
                ccInfo: {
                  last4: savedPaymentMethod.last4,
                  cardType: savedPaymentMethod.cardType,
                  expiryMonth: savedPaymentMethod.expiryMonth.toString(),
                  expiryYear: savedPaymentMethod.expiryYear.toString(),
                  nameOnCard: savedPaymentMethod.nameOnCard || undefined,
                },
                stripePaymentIntentId: paymentIntent.id,
                savedPaymentMethodId: savedPaymentMethod._id,
                recurringPaymentId: recurringPayment._id,
                paymentFrequency: 'monthly',
                notes: `Automatic monthly payment - ${recurringPayment.notes || ''}`,
              })
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
              } else {
                // Non-duplicate write failure: undo the pre-charge claim
                // so the next tick will retry. Idempotency key keeps
                // Stripe from charging twice.
                await RecurringPayment.updateOne(
                  { _id: recurringPayment._id, organizationId: ctx!.organizationId },
                  { $set: { nextPaymentDate: claimedDate } },
                ).catch(() => {})
                console.error(
                  '[recurring] ledger write failed after successful Stripe charge; rolled back schedule',
                  {
                    recurringPaymentId: recurringPayment._id.toString(),
                    paymentIntentId: paymentIntent.id,
                    err: err?.message,
                  },
                )
                // Classify as ledger-write failure, NOT a declined card.
                // The previous code re-threw to the outer catch, which
                // created a "payment declined" admin task even though
                // Stripe successfully charged the card. That:
                //   (a) misled the admin into thinking the family's card
                //       was bad — possible reaction is to disable the
                //       saved card and call the family, even though the
                //       card worked perfectly,
                //   (b) spammed the task list on any transient Mongo
                //       glitch.
                // Record the failure with a clearly different message
                // and do NOT open a payment-declined task. The next
                // cron tick will retry; the Stripe idempotency key
                // makes that safe.
                results.push({
                  recurringPaymentId: recurringPayment._id.toString(),
                  familyName: family?.name || 'Unknown',
                  status: 'failed',
                  error: sanitizeStripeErrorMessage(
                    `Ledger write failed after successful Stripe charge: ${err?.message || 'unknown error'}. Will retry on next cron tick.`,
                  ),
                })
                failed++
                continue
              }
            }
          }

          if (payment) scheduleYearlyCalculationRefreshForPayment(payment)

          results.push({
            recurringPaymentId: recurringPayment._id.toString(),
            familyName: family?.name || 'Unknown',
            status: 'success',
            paymentId: payment?._id?.toString(),
            amount: recurringPayment.amount,
            nextPaymentDate: intendedNextDate.toISOString(),
          })
          processed++
        } catch (error: any) {
          // Reached only on a Stripe charge failure (card declined,
          // network error talking to Stripe, etc.). Ledger-write failures
          // are handled inline above so they don't spuriously trigger
          // the "Card declined" admin task. The claim rollback in the
          // inner try/catch has already restored `nextPaymentDate` so
          // the next cron tick can retry.
          console.error(`Error processing recurring payment ${recurringPayment._id}:`, error)
          const errorMsg = sanitizeStripeErrorMessage(error.message)
          results.push({
            recurringPaymentId: recurringPayment._id.toString(),
            familyName: (recurringPayment.familyId as any)?.name || 'Unknown',
            status: 'failed',
            error: errorMsg,
          })

          const family = recurringPayment.familyId as any
          await createPaymentDeclinedTask(
            family?._id?.toString() || '',
            null,
            recurringPayment.amount,
            errorMsg,
            ctx!.organizationId,
            undefined,
            lastPaymentIntentId,
          )

          failed++
        }
      }

      if (duePayments.length < UNBOUNDED_LIST_CAP) break
      afterId = duePayments[duePayments.length - 1]._id as Types.ObjectId
    }

    if (processed === 0 && failed === 0) {
      return {
        data: {
          success: true,
          message: 'No recurring payments due',
          processed: 0,
          failed: 0,
          results: [],
        },
      }
    }

    return {
      data: {
        success: true,
        message: `Processed ${processed} payments, ${failed} failed`,
        processed,
        failed,
        results: results.map((r) =>
          r.error ? { ...r, error: sanitizeStripeErrorMessage(r.error) } : r,
        ),
      },
    }
  },
})

// GET - Get all recurring payments
export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/recurring-payments/process',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'recurring-payments-list',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const searchParams = request.nextUrl.searchParams
    const familyId = searchParams.get('familyId')
    const activeOnly = searchParams.get('activeOnly') !== 'false'

    const query: any = { organizationId: ctx!.organizationId }
    if (familyId) {
      if (!Types.ObjectId.isValid(familyId)) {
        return { status: 400, data: { error: 'Invalid familyId' } }
      }
      const fam = await Family.findOne({
        _id: familyId,
        organizationId: ctx!.organizationId,
      }).select('_id')
      if (!fam) {
        return { status: 404, data: { error: 'Family not found' } }
      }
      query.familyId = familyId
    }
    if (activeOnly) query.isActive = true

    const recurringPayments = await collectCompoundCursorPages<{
      _id: unknown
      nextPaymentDate?: string | Date | null
    }>(
      (filter, limit) =>
        RecurringPayment.find(filter)
          .populate({
            path: 'familyId',
            select: 'name email organizationId deletedAt',
            match: { organizationId: ctx!.organizationId },
            options: { includeDeleted: true },
          })
          .populate({
            path: 'savedPaymentMethodId',
            select:
              'last4 cardType expiryMonth expiryYear nameOnCard isDefault isActive organizationId',
            match: { organizationId: ctx!.organizationId },
          })
          .sort({ nextPaymentDate: 1, _id: 1 })
          .limit(limit)
          .exec() as Promise<Array<{ _id: unknown; nextPaymentDate?: string | Date | null }>>,
      query,
      'nextPaymentDate',
      1,
      (last) => ({
        v: last.nextPaymentDate ? new Date(last.nextPaymentDate as string | Date).getTime() : null,
        id: String(last._id),
      }),
    )

    return { data: recurringPayments }
  },
})
