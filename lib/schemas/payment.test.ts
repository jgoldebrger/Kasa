import { describe, expect, it } from 'vitest'
import {
  chargeSavedCardBody,
  paymentBody,
  paymentPlanBody,
  paymentPlanUpdateBody,
  paymentUpdateBody,
  withdrawalBody,
} from './payment'

const VALID_OID = '507f1f77bcf86cd799439011'

describe('payment schemas', () => {
  describe('paymentBody', () => {
    it('accepts a valid payment payload', () => {
      const result = paymentBody.safeParse({
        familyId: VALID_OID,
        amount: 250.5,
        paymentDate: '2025-01-15',
      })
      expect(result.success).toBe(true)
    })

    it('accepts optional payment method and cc info', () => {
      const result = paymentBody.safeParse({
        familyId: VALID_OID,
        amount: 100,
        paymentDate: '2025-01-15',
        paymentMethod: 'credit_card',
        ccInfo: { last4: '4242', cardType: 'visa' },
        paymentFrequency: 'monthly',
      })
      expect(result.success).toBe(true)
    })

    it('rejects missing familyId', () => {
      const result = paymentBody.safeParse({
        amount: 100,
        paymentDate: '2025-01-15',
      })
      expect(result.success).toBe(false)
    })

    it('rejects amounts with more than two decimal places', () => {
      const result = paymentBody.safeParse({
        familyId: VALID_OID,
        amount: 10.999,
        paymentDate: '2025-01-15',
      })
      expect(result.success).toBe(false)
    })

    it('rejects invalid last4 in ccInfo', () => {
      const result = paymentBody.safeParse({
        familyId: VALID_OID,
        amount: 100,
        paymentDate: '2025-01-15',
        ccInfo: { last4: '42' },
      })
      expect(result.success).toBe(false)
    })
  })

  describe('paymentUpdateBody', () => {
    it('accepts a partial update', () => {
      const result = paymentUpdateBody.safeParse({ amount: 50 })
      expect(result.success).toBe(true)
    })

    it('accepts an empty partial update', () => {
      const result = paymentUpdateBody.safeParse({})
      expect(result.success).toBe(true)
    })
  })

  describe('withdrawalBody', () => {
    it('accepts a valid withdrawal payload', () => {
      const result = withdrawalBody.safeParse({
        familyId: VALID_OID,
        amount: 75,
        withdrawalDate: '2025-02-01',
        reason: 'Refund',
      })
      expect(result.success).toBe(true)
    })

    it('rejects missing amount', () => {
      const result = withdrawalBody.safeParse({
        familyId: VALID_OID,
        withdrawalDate: '2025-02-01',
      })
      expect(result.success).toBe(false)
    })

    it('rejects negative amount', () => {
      const result = withdrawalBody.safeParse({
        familyId: VALID_OID,
        amount: -10,
        withdrawalDate: '2025-02-01',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('paymentPlanBody', () => {
    it('accepts a valid payment plan', () => {
      const result = paymentPlanBody.safeParse({
        name: 'Standard Plan',
        yearlyPrice: 1200,
      })
      expect(result.success).toBe(true)
    })

    it('rejects missing yearlyPrice', () => {
      const result = paymentPlanBody.safeParse({
        name: 'Standard Plan',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('paymentPlanUpdateBody', () => {
    it('accepts a partial plan update', () => {
      const result = paymentPlanUpdateBody.safeParse({ yearlyPrice: 1500 })
      expect(result.success).toBe(true)
    })
  })

  describe('chargeSavedCardBody', () => {
    it('accepts a valid charge payload', () => {
      const result = chargeSavedCardBody.safeParse({
        savedPaymentMethodId: VALID_OID,
        amount: 99.99,
      })
      expect(result.success).toBe(true)
    })

    it('rejects zero amount', () => {
      const result = chargeSavedCardBody.safeParse({
        savedPaymentMethodId: VALID_OID,
        amount: 0,
      })
      expect(result.success).toBe(false)
    })

    it('rejects missing savedPaymentMethodId', () => {
      const result = chargeSavedCardBody.safeParse({
        amount: 50,
      })
      expect(result.success).toBe(false)
    })

    it('accepts optional paymentDate and memberId', () => {
      const result = chargeSavedCardBody.safeParse({
        savedPaymentMethodId: VALID_OID,
        amount: 50,
        paymentDate: '2025-03-01',
        memberId: VALID_OID,
        paymentFrequency: 'one-time',
      })
      expect(result.success).toBe(true)
    })
  })
})
