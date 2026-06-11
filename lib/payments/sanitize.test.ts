import { setNodeEnv } from '@/lib/test/type-helpers'
import { describe, expect, it, afterEach } from 'vitest'
import {
  sanitizeBatchErrors,
  sanitizePaymentNotes,
  sanitizeStripeErrorMessage,
} from './sanitize'

describe('sanitizePaymentNotes', () => {
  it('redacts Stripe identifiers', () => {
    const notes = 'pi_abc123 pm_card ch_123 Stripe PaymentIntent pi_xyz'
    expect(sanitizePaymentNotes(notes)).toContain('[payment]')
    expect(sanitizePaymentNotes(notes)).toContain('[card]')
    expect(sanitizePaymentNotes(notes)).toContain('[charge]')
    expect(sanitizePaymentNotes(notes)).toContain('Stripe payment')
    expect(sanitizePaymentNotes(notes)).not.toMatch(/\bpi_/)
  })

  it('returns empty string for blank input', () => {
    expect(sanitizePaymentNotes(null)).toBe('')
  })
})

describe('sanitizeStripeErrorMessage', () => {
  it('returns a generic message when empty', () => {
    expect(sanitizeStripeErrorMessage('')).toBe('Payment failed')
  })
})

describe('sanitizeBatchErrors', () => {
  const prevEnv = process.env.NODE_ENV

  afterEach(() => {
    setNodeEnv(prevEnv
)
  })

  it('caps and truncates errors in development', () => {
    setNodeEnv('development'
)
    const out = sanitizeBatchErrors(['a'.repeat(400)], 1)
    expect(out).toHaveLength(1)
    expect(out[0].length).toBe(300)
  })

  it('sanitizes errors in production', () => {
    setNodeEnv('production'
)
    const out = sanitizeBatchErrors(['pi_secret123 failed'])
    expect(out[0]).not.toContain('pi_')
  })
})
