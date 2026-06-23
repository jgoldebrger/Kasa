/**
 * Process all due recurring payments for one organization.
 *
 * Shared by POST /api/recurring-payments/process and the
 * process-recurring-payments cron job (in-process — no HTTP hop).
 */

import { Types } from 'mongoose'
import { Organization, RecurringPayment, Payment, SavedPaymentMethod } from '@/lib/models'
import { UNBOUNDED_LIST_CAP } from '@/lib/schemas'
import { createPaymentDeclinedTask } from '@/lib/task-helpers'
import { sanitizeStripeErrorMessage } from '@/lib/payments/sanitize'
import { buildIdempotencyKey, resolveStripeCurrency, toMinorUnits } from '@/lib/money'
import { getOrgCurrency } from '@/lib/money.server'
import { addMonthsClamped, getYearInTimeZone, startOfDayInTimeZone } from '@/lib/date-utils'
import { enforceMemberChargeGate } from '@/lib/billing/feature-gate'
import { scheduleYearlyCalculationRefreshForPayment } from '@/lib/calculations'
import {
  connectRequestOptions,
  getOrgStripeConnect,
  getPlatformStripe,
  isLegacyPlatformPaymentMethod,
  isStripeConnectEnabled,
  ORG_CONNECT_WITH_TIMEZONE_SELECT,
  type OrgStripeConnectFields,
} from '@/lib/stripe/client'
import type Stripe from 'stripe'

export class RecurringBillingGateError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'RecurringBillingGateError'
  }
}

export interface RecurringPaymentItemResult {
  recurringPaymentId: string
  familyName: string
  status: 'success' | 'failed' | 'skipped'
  error?: string
  paymentId?: string
  amount?: number
  nextPaymentDate?: string
}

export interface ProcessRecurringPaymentsResult {
  success: boolean
  message: string
  processed: number
  failed: number
  results: RecurringPaymentItemResult[]
}

/**
 * Charge due recurring payments for one org. Throws when the org cannot
 * charge members (billing / Connect gate). Individual card failures are
 * recorded in `results` and do not throw.
 */
export async function processRecurringPaymentsForOrg(
  organizationId: string,
): Promise<ProcessRecurringPaymentsResult> {
  const billingGate = await enforceMemberChargeGate(organizationId)
  if (!billingGate.ok) {
    throw new RecurringBillingGateError(billingGate.error, billingGate.status)
  }

  const orgCurrency = await getOrgCurrency(organizationId)
  const stripeCurrency = resolveStripeCurrency(orgCurrency)

  const org = await Organization.findById(organizationId)
    .select(ORG_CONNECT_WITH_TIMEZONE_SELECT)
    .lean<OrgStripeConnectFields & { timezone?: string }>()
  const connect = getOrgStripeConnect(org)
  const today = startOfDayInTimeZone(org?.timezone)

  const results: RecurringPaymentItemResult[] = []
  let processed = 0
  let failed = 0

  let afterId: Types.ObjectId | null = null
  for (;;) {
    const dueFilter: Record<string, unknown> = {
      isActive: true,
      nextPaymentDate: { $lte: today },
      organizationId,
    }
    if (afterId) dueFilter._id = { $gt: afterId }

    const duePayments = await RecurringPayment.find(dueFilter)
      .populate({
        path: 'familyId',
        select: 'name email organizationId',
        match: { organizationId },
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
          organizationId,
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

        if (isStripeConnectEnabled()) {
          if (!connect) {
            results.push({
              recurringPaymentId: recurringPayment._id.toString(),
              familyName: family?.name || 'Unknown',
              status: 'skipped',
              error:
                'Recurring billing paused — complete Stripe Connect onboarding in Settings → Billing.',
            })
            continue
          }
          if (isLegacyPlatformPaymentMethod(savedPaymentMethod)) {
            results.push({
              recurringPaymentId: recurringPayment._id.toString(),
              familyName: family?.name || 'Unknown',
              status: 'skipped',
              error:
                'Recurring billing paused — saved card must be re-entered after Connect onboarding.',
            })
            continue
          }
        }

        const intendedNextDate = addMonthsClamped(recurringPayment.nextPaymentDate, 1)
        const claimedDate = recurringPayment.nextPaymentDate
        const claim = await RecurringPayment.updateOne(
          {
            _id: recurringPayment._id,
            organizationId,
            isActive: true,
            nextPaymentDate: claimedDate,
          },
          { $set: { nextPaymentDate: intendedNextDate } },
        )
        if (claim.modifiedCount !== 1) {
          continue
        }

        const billingPeriodKey = claimedDate.toISOString().slice(0, 10)
        const idempotencyKey = buildIdempotencyKey([
          'pi-recurring',
          organizationId,
          recurringPayment._id.toString(),
          billingPeriodKey,
          toMinorUnits(recurringPayment.amount, orgCurrency),
          stripeCurrency,
        ])

        const stripe = getPlatformStripe()
        if (!stripe) {
          throw new Error('STRIPE_SECRET_KEY is not configured')
        }
        let paymentIntent: Stripe.PaymentIntent
        try {
          paymentIntent = await stripe.paymentIntents.create(
            {
              amount: toMinorUnits(recurringPayment.amount, orgCurrency),
              currency: stripeCurrency,
              payment_method: savedPaymentMethod.stripePaymentMethodId,
              confirm: true,
              off_session: true,
              description: `Monthly recurring payment for ${family?.name || 'family'}`,
              metadata: {
                familyId: family?._id?.toString() || '',
                organizationId,
                recurringPaymentId: recurringPayment._id.toString(),
                billingPeriod: billingPeriodKey,
              },
            },
            connectRequestOptions(connect, { idempotencyKey }),
          )
        } catch (chargeErr) {
          await RecurringPayment.updateOne(
            { _id: recurringPayment._id, organizationId },
            { $set: { nextPaymentDate: claimedDate } },
          ).catch(() => {})
          throw chargeErr
        }
        lastPaymentIntentId = paymentIntent.id

        if (paymentIntent.status !== 'succeeded') {
          const errorMsg = `Payment failed. Status: ${paymentIntent.status}`
          await RecurringPayment.updateOne(
            { _id: recurringPayment._id, organizationId },
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
            organizationId,
            undefined,
            paymentIntent.id,
          )
          failed++
          continue
        }

        const existingPayment = await Payment.findOne(
          {
            organizationId,
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
              organizationId,
              familyId: recurringPayment.familyId,
              amount: recurringPayment.amount,
              paymentDate: paymentDate,
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
                  organizationId,
                  stripePaymentIntentId: paymentIntent.id,
                },
                null,
                { includeDeleted: true },
              )
            } else {
              await RecurringPayment.updateOne(
                { _id: recurringPayment._id, organizationId },
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
          organizationId,
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
      success: true,
      message: 'No recurring payments due',
      processed: 0,
      failed: 0,
      results: [],
    }
  }

  return {
    success: true,
    message: `Processed ${processed} payments, ${failed} failed`,
    processed,
    failed,
    results: results.map((r) =>
      r.error ? { ...r, error: sanitizeStripeErrorMessage(r.error) } : r,
    ),
  }
}
