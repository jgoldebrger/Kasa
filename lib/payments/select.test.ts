import { describe, expect, it } from 'vitest'
import { PAYMENT_PUBLIC_SELECT, serializePaymentPublic, serializePaymentsPublic } from './select'
import { sanitizePaymentNotes } from './sanitize'

describe('PAYMENT_PUBLIC_SELECT', () => {
  const expectedFields = [
    '_id',
    'familyId',
    'memberId',
    'amount',
    'paymentDate',
    'year',
    'type',
    'paymentMethod',
    'ccInfo',
    'checkInfo',
    'notes',
    'paymentFrequency',
    'createdAt',
    'refundedAmount',
    'refundedAt',
    'disputedAt',
    'disputeStatus',
  ]

  it('contains the expected public payment fields', () => {
    expect(PAYMENT_PUBLIC_SELECT.split(' ')).toEqual(expectedFields)
  })

  it('does not include sensitive or internal-only fields', () => {
    const fields = PAYMENT_PUBLIC_SELECT.split(' ')
    expect(fields).not.toContain('stripePaymentIntentId')
    expect(fields).not.toContain('idempotencyKey')
    expect(fields).not.toContain('__v')
  })
})

describe('serializePaymentPublic', () => {
  it('redacts stripe ids in notes', () => {
    const payment = {
      _id: '507f1f77bcf86cd799439011',
      notes: 'Stripe PaymentIntent pi_abc123',
    }
    expect(serializePaymentPublic(payment).notes).toBe(sanitizePaymentNotes(payment.notes))
  })

  it('maps arrays via serializePaymentsPublic', () => {
    const rows = [{ notes: 'pm_xyz' }, { notes: null }]
    expect(serializePaymentsPublic(rows)[0].notes).toBe('[card]')
    expect(serializePaymentsPublic(rows)[1].notes).toBeNull()
  })
})
