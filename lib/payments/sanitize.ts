/** Redact Stripe identifiers from user-visible payment notes. */
export function sanitizePaymentNotes(notes: string | undefined | null): string {
  if (!notes) return ''
  return notes
    .replace(/\bpi_[a-zA-Z0-9]+\b/g, '[payment]')
    .replace(/\bpm_[a-zA-Z0-9]+\b/g, '[card]')
    .replace(/\bch_[a-zA-Z0-9]+\b/g, '[charge]')
    .replace(/\bStripe PaymentIntent \S+/gi, 'Stripe payment')
    .trim()
}

/** Strip Stripe-style ids from admin-facing error strings. */
export function sanitizeStripeErrorMessage(message: string | undefined | null): string {
  if (!message) return 'Payment failed'
  return sanitizePaymentNotes(message) || 'Payment failed'
}

/** Cap and redact batch error arrays returned to clients in production. */
export function sanitizeBatchErrors(errors: string[], cap = 20): string[] {
  const sliced = errors.slice(0, cap).map((e) => String(e ?? '').slice(0, 300))
  if (process.env.NODE_ENV === 'production') {
    return sliced.map((e) => sanitizeStripeErrorMessage(e))
  }
  return sliced
}
