import { z } from 'zod'
import { isoDate, moneyAmount, objectId, optionalString, trimmedName, yearParam } from './common'

export const stripePaymentIntentId = z
  .string()
  .regex(/^pi_[a-zA-Z0-9]+$/, 'Invalid payment intent ID format')

export const stripePaymentMethodId = z
  .string()
  .regex(/^pm_[a-zA-Z0-9]+$/, 'Invalid payment method ID format')

export const paymentBody = z.object({
  familyId: objectId,
  memberId: objectId.optional().nullable(),
  amount: moneyAmount,
  paymentDate: isoDate,
  year: yearParam.optional(),
  type: optionalString(60),
  paymentMethod: z.enum(['cash', 'credit_card', 'check', 'quick_pay']).optional(),
  ccInfo: z
    .object({
      last4: z
        .string()
        .regex(/^\d{4}$/)
        .optional(),
      cardType: optionalString(40),
      expiryMonth: optionalString(2),
      expiryYear: optionalString(4),
      nameOnCard: optionalString(120),
    })
    .optional(),
  checkInfo: z
    .object({
      checkNumber: optionalString(40),
      bankName: optionalString(120),
      routingNumber: optionalString(40),
    })
    .optional(),
  stripePaymentIntentId: optionalString(120),
  savedPaymentMethodId: objectId.optional().nullable(),
  paymentFrequency: z.enum(['one-time', 'monthly']).optional(),
  notes: optionalString(2000),
})

export const paymentUpdateBody = paymentBody.partial()

export const withdrawalBody = z.object({
  familyId: objectId,
  amount: moneyAmount,
  withdrawalDate: isoDate,
  reason: optionalString(500),
  notes: optionalString(2000),
})

export const paymentPlanBody = z.object({
  name: trimmedName,
  planNumber: z.coerce.number().int().min(1).optional(),
  yearlyPrice: moneyAmount,
  description: optionalString(500),
})

export const paymentPlanUpdateBody = paymentPlanBody.partial()

export const chargeSavedCardBody = z.object({
  savedPaymentMethodId: objectId,
  amount: moneyAmount.gt(0, 'Amount must be greater than 0'),
  paymentDate: isoDate.optional(),
  year: yearParam.optional(),
  type: optionalString(60),
  notes: optionalString(2000),
  memberId: objectId.optional(),
  paymentFrequency: z.enum(['one-time', 'monthly']).optional(),
})

export const savePaymentMethodBody = z.object({
  paymentMethodId: stripePaymentMethodId,
  paymentIntentId: z.string().trim().min(1, 'paymentIntentId is required'),
  setAsDefault: z.boolean().optional(),
})

export const createPaymentIntentBody = z
  .object({
    familyId: objectId,
    amount: moneyAmount.gt(0, 'Invalid amount'),
    description: optionalString(500),
    idempotencyHint: optionalString(200),
  })
  .refine((d) => d.amount <= 100_000, {
    message: 'Amount exceeds maximum of 100,000',
  })

export const confirmPaymentBody = z.object({
  paymentIntentId: stripePaymentIntentId,
  familyId: objectId,
  paymentDate: isoDate.optional(),
  year: yearParam.optional(),
  type: optionalString(60),
  notes: optionalString(2000),
  paymentFrequency: z.enum(['one-time', 'monthly']).optional(),
  savedPaymentMethodId: z.union([objectId, z.literal('will_be_saved')]).optional(),
  memberId: objectId.optional(),
})
