import { describe, expect, it } from 'vitest'
import { PAYMENT_PUBLIC_SELECT } from './select'

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
