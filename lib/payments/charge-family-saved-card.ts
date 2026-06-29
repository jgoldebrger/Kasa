/**
 * Charge one family saved card off-session. Shared by single-family and
 * batch-charge routes.
 */

import { Types } from 'mongoose'
import type { NextRequest } from 'next/server'
import { SavedPaymentMethod, Payment, Family, Organization, RecurringPayment } from '@/lib/models'
import { createPaymentDeclinedTask } from '@/lib/task-helpers'
import { buildIdempotencyKey, resolveStripeCurrency, toMinorUnits } from '@/lib/money'
import { getOrgCurrency } from '@/lib/money.server'
import { addMonthsClamped, getYearInTimeZone } from '@/lib/date-utils'
import { audit } from '@/lib/audit'
import { PAYMENT_PUBLIC_SELECT, serializePaymentPublic } from '@/lib/payments/select'
import { sanitizeStripeErrorMessage } from '@/lib/payments/sanitize'
import { scheduleYearlyCalculationRefresh } from '@/lib/calculations'
import {
  connectRequestOptions,
  getOrgStripeConnect,
  isLegacyPlatformPaymentMethod,
  ORG_CONNECT_WITH_TIMEZONE_SELECT,
  type OrgStripeConnectFields,
} from '@/lib/stripe/client'
const MAX_CHARGE = 100_000

export interface ChargeFamilySavedCardInput {
  organizationId: string
  userId?: string
  familyId: string
  savedPaymentMethodId: string
  amount: number
  type?: string
  notes?: string
  recurringPaymentId?: string
  advanceRecurringSchedule?: boolean
  idempotencyPrefix?: string
  request?: NextRequest
}

export type ChargeFamilySavedCardResult =
  | { ok: true; paymentId: string; deduplicated?: boolean }
  | { ok: false; error: string; status?: number }

export async function chargeFamilySavedCard(
  input: ChargeFamilySavedCardInput,
): Promise<ChargeFamilySavedCardResult> {
  const {
    organizationId,
    userId,
    familyId,
    savedPaymentMethodId,
    amount,
    type = 'membership',
    notes,
    recurringPaymentId,
    advanceRecurringSchedule = false,
    idempotencyPrefix = 'pi-batch-charge',
    request,
  } = input

  if (amount <= 0) return { ok: false, error: 'Amount must be greater than 0', status: 400 }
  if (amount > MAX_CHARGE) {
    return {
      ok: false,
      error: `Amount exceeds maximum of ${MAX_CHARGE.toLocaleString()}`,
      status: 400,
    }
  }

  const family = await Family.findOne({ _id: familyId, organizationId }).select('_id name')
  if (!family) return { ok: false, error: 'Family not found', status: 404 }

  const savedPaymentMethod = await SavedPaymentMethod.findOne({
    _id: savedPaymentMethodId,
    organizationId,
    familyId,
    isActive: true,
  })
  if (!savedPaymentMethod) {
    return { ok: false, error: 'Saved payment method not found', status: 404 }
  }
  if (isLegacyPlatformPaymentMethod(savedPaymentMethod)) {
    return {
      ok: false,
      error: 'Saved card must be re-entered after Connect onboarding',
      status: 400,
    }
  }

  const org = await Organization.findById(organizationId)
    .select(ORG_CONNECT_WITH_TIMEZONE_SELECT)
    .lean<OrgStripeConnectFields & { timezone?: string }>()
  const connect = getOrgStripeConnect(org)
  const orgCurrency = await getOrgCurrency(organizationId)
  const stripeCurrency = resolveStripeCurrency(orgCurrency)
  const amountMinor = toMinorUnits(amount, orgCurrency)

  let claimedRecurringDate: Date | undefined
  let recurringRow: InstanceType<typeof RecurringPayment> | null = null
  if (advanceRecurringSchedule && recurringPaymentId) {
    recurringRow = await RecurringPayment.findOne({
      _id: recurringPaymentId,
      organizationId,
      familyId,
      isActive: true,
    })
    if (recurringRow) {
      const intendedNext = addMonthsClamped(recurringRow.nextPaymentDate, 1)
      claimedRecurringDate = recurringRow.nextPaymentDate
      const claim = await RecurringPayment.updateOne(
        {
          _id: recurringRow._id,
          organizationId,
          isActive: true,
          nextPaymentDate: claimedRecurringDate,
        },
        { $set: { nextPaymentDate: intendedNext } },
      )
      if (claim.modifiedCount !== 1) {
        return { ok: false, error: 'Recurring payment already processed', status: 409 }
      }
    }
  }

  const dayBucket = new Date().toISOString().slice(0, 16)
  const idempotencyKey = buildIdempotencyKey([
    idempotencyPrefix,
    organizationId,
    familyId,
    savedPaymentMethodId,
    amountMinor,
    stripeCurrency,
    recurringPaymentId || '',
    dayBucket,
  ])

  const stripe = (await import('@/lib/stripe/client')).getPlatformStripe()
  if (!stripe) return { ok: false, error: 'Stripe is not configured', status: 500 }

  let paymentIntentId: string | undefined
  try {
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountMinor,
        currency: stripeCurrency,
        payment_method: savedPaymentMethod.stripePaymentMethodId,
        confirm: true,
        off_session: true,
        description: `${type} payment for family ${familyId}`,
        metadata: {
          familyId,
          organizationId,
          savedPaymentMethodId,
          ...(recurringPaymentId ? { recurringPaymentId } : {}),
        },
      },
      connectRequestOptions(connect, { idempotencyKey }),
    )
    paymentIntentId = paymentIntent.id

    if (paymentIntent.status !== 'succeeded') {
      if (recurringRow && claimedRecurringDate) {
        await RecurringPayment.updateOne(
          { _id: recurringRow._id, organizationId },
          { $set: { nextPaymentDate: claimedRecurringDate } },
        ).catch(() => {})
      }
      const msg = `Payment failed. Status: ${paymentIntent.status}`
      await createPaymentDeclinedTask(
        familyId,
        null,
        amount,
        msg,
        organizationId,
        undefined,
        paymentIntent.id,
      )
      return { ok: false, error: 'Payment was not completed', status: 400 }
    }

    const existing = await Payment.findOne(
      { organizationId, stripePaymentIntentId: paymentIntent.id },
      null,
      { includeDeleted: true },
    )
    if (existing) {
      return { ok: true, paymentId: String(existing._id), deduplicated: true }
    }

    const paymentDate = new Date()
    const paymentData = {
      organizationId: new Types.ObjectId(organizationId),
      familyId: new Types.ObjectId(familyId),
      amount,
      paymentDate,
      year: getYearInTimeZone(org?.timezone, paymentDate),
      type: (type || 'membership') as 'membership' | 'donation' | 'other',
      paymentMethod: 'credit_card' as const,
      ccInfo: {
        last4: savedPaymentMethod.last4,
        cardType: savedPaymentMethod.cardType,
        expiryMonth: savedPaymentMethod.expiryMonth.toString(),
        expiryYear: savedPaymentMethod.expiryYear.toString(),
        nameOnCard: savedPaymentMethod.nameOnCard || undefined,
      },
      stripePaymentIntentId: paymentIntent.id,
      savedPaymentMethodId: new Types.ObjectId(savedPaymentMethodId),
      paymentFrequency: recurringPaymentId ? ('monthly' as const) : ('one-time' as const),
      recurringPaymentId: recurringPaymentId ? new Types.ObjectId(recurringPaymentId) : undefined,
      notes: notes || undefined,
    }

    let payment
    try {
      payment = await Payment.create(paymentData)
    } catch (err: any) {
      if (err?.code === 11000) {
        const dup = await Payment.findOne(
          { organizationId, stripePaymentIntentId: paymentIntent.id },
          null,
          { includeDeleted: true },
        )
        if (dup) return { ok: true, paymentId: String(dup._id), deduplicated: true }
      }
      if (recurringRow && claimedRecurringDate) {
        await RecurringPayment.updateOne(
          { _id: recurringRow._id, organizationId },
          { $set: { nextPaymentDate: claimedRecurringDate } },
        ).catch(() => {})
      }
      return {
        ok: false,
        error: 'Stripe charge succeeded but ledger write failed',
        status: 500,
      }
    }

    await audit({
      organizationId,
      userId,
      action: 'payment.batch_charge',
      resourceType: 'Payment',
      resourceId: payment._id,
      metadata: {
        familyId,
        amount,
        stripePaymentIntentId: paymentIntent.id,
        savedPaymentMethodId,
        recurringPaymentId,
      },
      request,
    })

    scheduleYearlyCalculationRefresh(paymentData.year, organizationId)

    return { ok: true, paymentId: String(payment._id) }
  } catch (error: any) {
    if (recurringRow && claimedRecurringDate) {
      await RecurringPayment.updateOne(
        { _id: recurringRow._id, organizationId },
        { $set: { nextPaymentDate: claimedRecurringDate } },
      ).catch(() => {})
    }
    await createPaymentDeclinedTask(
      familyId,
      null,
      amount,
      sanitizeStripeErrorMessage(error?.message) || 'Unknown error',
      organizationId,
      undefined,
      paymentIntentId,
    ).catch(() => {})
    return {
      ok: false,
      error: sanitizeStripeErrorMessage(error?.message) || 'Failed to charge saved card',
      status: 500,
    }
  }
}

export async function loadChargedPaymentPublic(paymentId: string, organizationId: string) {
  const row = await Payment.findOne({ _id: paymentId, organizationId })
    .select(PAYMENT_PUBLIC_SELECT)
    .lean()
  return row ? serializePaymentPublic(row) : null
}
