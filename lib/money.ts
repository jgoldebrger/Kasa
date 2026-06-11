/**
 * Money + Stripe currency helpers.
 *
 * KASA stores money amounts as plain JS numbers (dollars/major units).
 * Stripe wants minor units (cents) as integers. Bare `amount * 100`
 * round-trips through binary floating point and can produce off-by-one
 * errors (e.g. `10.05 * 100 = 1004.9999…`), so we route every dollars→
 * cents conversion through `toMinorUnits` which first normalises to two
 * decimal places.
 *
 * Stripe also charges by ISO-4217 currency code. Org-default is USD but
 * each Organization can override via `Organization.currency`; this helper
 * normalises and validates the code before handing it to Stripe.
 */

import { isSupportedCurrency } from './currency'

/** Round a money amount to two decimal places using banker-safe math. */
export function roundMoney(amount: number): number {
  if (!Number.isFinite(amount)) return 0
  return Math.round(amount * 100) / 100
}

/** Sum a list of money values, rounding at the end to kill FP drift. */
export function sumMoney(values: ReadonlyArray<number | null | undefined>): number {
  let total = 0
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) total += v
  }
  return roundMoney(total)
}

/** Net credited amount after partial/full refunds. */
export function netPaymentAmount(payment: {
  amount?: number | null
  refundedAmount?: number | null
}): number {
  return Math.max(0, Number(payment.amount || 0) - Number(payment.refundedAmount || 0))
}

/**
 * Stripe minor-unit exponents per ISO-4217. The default is 2 (most
 * currencies). The few zero-decimal currencies we might ever support
 * (JPY, KRW, etc.) are listed explicitly so a future expansion of the
 * supported list doesn't silently 100x charges.
 *
 * Source: https://stripe.com/docs/currencies#zero-decimal
 */
const CURRENCY_EXPONENTS: Record<string, number> = {
  JPY: 0,
  KRW: 0,
  VND: 0,
  CLP: 0,
  // Three-decimal currencies are NOT included here because Stripe still
  // expects them charged with the smallest billable unit (last digit
  // rounded to 0).
}

function exponentFor(currency: string): number {
  const code = String(currency || 'USD').toUpperCase()
  return CURRENCY_EXPONENTS[code] ?? 2
}

/**
 * Convert a major-unit money amount (dollars) to minor units (cents) for
 * Stripe. The two-step toFixed → Number avoids `10.05 * 100 = 1004.99…`
 * style off-by-one bugs.
 *
 * Pass `currency` for non-USD currencies — zero-decimal currencies (JPY,
 * KRW, …) must NOT be multiplied by 100. Without this, ¥1,000 would be
 * sent to Stripe as 100,000 ¥ and the customer would be charged 100×.
 * Callers without a currency context get the 2-decimal default, matching
 * historical behaviour.
 */
export function toMinorUnits(amount: number, currency: string = 'USD'): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('toMinorUnits requires a finite, non-negative amount')
  }
  const exp = exponentFor(currency)
  const factor = 10 ** exp
  return Math.round(Number(amount.toFixed(exp)) * factor)
}

/** Inverse of `toMinorUnits` — Stripe minor units → dollars. */
export function fromMinorUnits(minor: number, currency: string = 'USD'): number {
  const exp = exponentFor(currency)
  const factor = 10 ** exp
  return roundMoney(Number(minor || 0) / factor)
}

/** Resolve the lowercased ISO-4217 currency code for a Stripe call. */
export function resolveStripeCurrency(code?: string | null): string {
  const candidate = String(code || 'USD').toUpperCase()
  const safe = isSupportedCurrency(candidate) ? candidate : 'USD'
  return safe.toLowerCase()
}

/**
 * Stable Stripe idempotency key. Pass the same logical inputs and Stripe
 * returns the prior PaymentIntent rather than charging again. Suitable
 * for the recurring-payment cron, retried confirm calls, etc.
 */
export function buildIdempotencyKey(parts: ReadonlyArray<string | number | null | undefined>): string {
  return parts.map((p) => String(p ?? '')).join(':').slice(0, 255)
}
