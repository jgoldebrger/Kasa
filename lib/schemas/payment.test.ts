import { describe, expect, it } from 'vitest'
import {
  chargeSavedCardBody,
  confirmPaymentBody,
  createPaymentIntentBody,
  paymentBody,
  paymentPlanBody,
  paymentPlanUpdateBody,
  paymentUpdateBody,
  savePaymentMethodBody,
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

  describe('savePaymentMethodBody', () => {
    it('accepts valid stripe ids', () => {
      const result = savePaymentMethodBody.safeParse({
        paymentMethodId: 'pm_abc123',
        paymentIntentId: 'pi_xyz789',
        setAsDefault: true,
      })
      expect(result.success).toBe(true)
    })

    it('rejects invalid payment method id', () => {
      expect(
        savePaymentMethodBody.safeParse({
          paymentMethodId: 'bad',
          paymentIntentId: 'pi_xyz789',
        }).success,
      ).toBe(false)
    })
  })

  describe('createPaymentIntentBody', () => {
    it('accepts a valid payload', () => {
      const result = createPaymentIntentBody.safeParse({
        familyId: VALID_OID,
        amount: 100,
      })
      expect(result.success).toBe(true)
    })

    it('rejects amounts above the cap', () => {
      expect(
        createPaymentIntentBody.safeParse({
          familyId: VALID_OID,
          amount: 100_001,
        }).success,
      ).toBe(false)
    })
  })

  describe('confirmPaymentBody', () => {
    it('accepts will_be_saved sentinel', () => {
      const result = confirmPaymentBody.safeParse({
        paymentIntentId: 'pi_abc123',
        familyId: VALID_OID,
        savedPaymentMethodId: 'will_be_saved',
      })
      expect(result.success).toBe(true)
    })
  })
})
