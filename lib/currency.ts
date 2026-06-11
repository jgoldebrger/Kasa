/**
 * Currency + locale formatting helpers.
 *
 * Money amounts are stored as plain JS numbers throughout the codebase
 * (no minor-unit / cents conversion). The currency *code* lives on the
 * Organization document and only affects how amounts render. Conversion
 * across currencies is intentionally out of scope — switching the org's
 * currency reinterprets existing amounts in the new code without doing
 * any FX math.
 *
 * Two layers:
 *   - `formatMoney(value, { currency, locale })` — direct, stateless
 *   - `useCurrency()` / `OrgCurrencyProvider` — React context wiring
 *     so deep components don't have to thread the currency manually
 */

export interface MoneyFormatOptions {
  /** ISO 4217 code, e.g. 'USD', 'EUR', 'ILS', 'GBP'. */
  currency?: string
  /** BCP 47 locale, e.g. 'en-US', 'he-IL'. Falls back to runtime default. */
  locale?: string
  /** When true (default), trims trailing zero decimals. */
  trimZeros?: boolean
  /** Render the bare number with no currency symbol. */
  noSymbol?: boolean
}

const SUPPORTED_CURRENCIES = [
  'USD',
  'CAD',
  'EUR',
  'GBP',
  'ILS', // Israeli Shekel
  'AUD',
  'CHF',
  'MXN',
  'BRL',
  'ZAR',
] as const
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number]

export function isSupportedCurrency(code: string): code is SupportedCurrency {
  return SUPPORTED_CURRENCIES.includes(code as SupportedCurrency)
}

export function listSupportedCurrencies(): SupportedCurrency[] {
  return [...SUPPORTED_CURRENCIES]
}

/**
 * Format an amount using Intl.NumberFormat. Safe for both server and
 * client; never throws — falls back to a plain `$N` style string if
 * Intl can't find the requested currency/locale combination.
 */
export function formatMoney(value: number | null | undefined, opts: MoneyFormatOptions = {}): string {
  // Guard with Number.isFinite so we don't silently render `NaN` /
  // `Infinity` (and so a bogus string like '12abc' doesn't become 0).
  // We collapse all non-finite inputs to 0 deliberately — that matches
  // what users expect for "empty/invalid amount" UI states.
  const raw = typeof value === 'number' ? value : Number(value)
  const amount = Number.isFinite(raw) ? raw : 0
  const currency = (opts.currency || 'USD').toUpperCase()
  const locale = opts.locale || 'en-US'
  const trimZeros = opts.trimZeros !== false
  try {
    if (opts.noSymbol) {
      return new Intl.NumberFormat(locale, {
        minimumFractionDigits: trimZeros && Number.isInteger(amount) ? 0 : 2,
        maximumFractionDigits: 2,
      }).format(amount)
    }
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: trimZeros && Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    // Unknown currency/locale → degrade to "USD 1234" so we at least
    // tell the user what the unit is.
    return `${currency} ${amount.toLocaleString()}`
  }
}

/**
 * Return only the currency *symbol* for the given code in the given
 * locale, e.g. `$`, `€`, `₪`. Useful for compact UI like input adornments.
 */
export function currencySymbol(currency = 'USD', locale = 'en-US'): string {
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0)
    const sym = parts.find((p) => p.type === 'currency')?.value
    return sym || currency
  } catch {
    return currency
  }
}
