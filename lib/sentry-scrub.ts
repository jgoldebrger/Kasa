/**
 * Shared Sentry `beforeSend` scrubber.
 *
 * Sentry events can carry exception messages, request bodies, query
 * strings, breadcrumbs, and tags — any of which can pick up PII or
 * payment secrets in this app (email addresses, reset tokens, Stripe
 * client_secrets, full credit-card last4 strings, encrypted SMTP
 * passwords). We redact those at the SDK boundary so they never reach
 * Sentry's servers, even when developers add new logs that incidentally
 * dump a request body.
 *
 * Keep this pure and synchronous — Sentry calls it on every event from
 * both the server and client SDKs.
 */

type AnyEvent = Record<string, any>

/** Field names that should never reach Sentry, case-insensitive. */
const SENSITIVE_KEY =
  /^(password|hashedpassword|newpassword|currentpassword|token|access[_-]?token|refresh[_-]?token|client_secret|clientSecret|stripe-?signature|authorization|cookie|set-cookie|x-csrf-token|x-cron-secret|x-cron-job-token|jobtoken|ccinfo|cc[_-]?number|cvv|cvc|secret|encryptionkey|nextauth_secret|cron_secret|smtp.*password|reset[_-]?url|two[_-]?factor[_-]?secret|backup[_-]?codes?)$/i

/** Patterns we redact inside free-form strings (messages, URLs). */
const VALUE_PATTERNS: Array<{ re: RegExp; replace: string }> = [
  // Emails
  { re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replace: '[redacted-email]' },
  // Stripe IDs that double as bearer tokens (client_secret)
  { re: /pi_[A-Za-z0-9_]+_secret_[A-Za-z0-9]+/g, replace: '[redacted-stripe-secret]' },
  { re: /seti_[A-Za-z0-9_]+_secret_[A-Za-z0-9]+/g, replace: '[redacted-stripe-secret]' },
  // Reset-password URL paths leak the single-use token in the path.
  { re: /\/reset-password\/[A-Za-z0-9_\-]+/g, replace: '/reset-password/[redacted]' },
  // 16-digit card number runs
  { re: /\b(?:\d[ -]?){13,19}\b/g, replace: '[redacted-card]' },
]

function redactString(input: string): string {
  let out = input
  for (const { re, replace } of VALUE_PATTERNS) out = out.replace(re, replace)
  return out
}

/** Scrub arbitrary payloads (Sentry `extra`, log context, etc.) before export. */
export function scrubSentryData(value: unknown): unknown {
  return scrub(value, 0)
}

function scrub(value: any, depth = 0): any {
  if (value == null) return value
  if (depth > 6) return '[depth-limit]'
  if (typeof value === 'string') return redactString(value)
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1))
  const out: AnyEvent = {}
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(k)) {
      out[k] = '[redacted]'
      continue
    }
    out[k] = scrub(v, depth + 1)
  }
  return out
}

export function sentryBeforeSend(event: AnyEvent, _hint?: unknown): AnyEvent {
  try {
    if (event.message) event.message = redactString(String(event.message))
    if (event.request) event.request = scrub(event.request)
    if (event.contexts) event.contexts = scrub(event.contexts)
    if (event.extra) event.extra = scrub(event.extra)
    if (event.tags) event.tags = scrub(event.tags)
    if (event.user) {
      // We keep the user id (for triage) but drop email / username /
      // ip_address which are PII.
      const { id } = event.user as { id?: string }
      event.user = id ? { id } : undefined
    }
    if (event.breadcrumbs && Array.isArray(event.breadcrumbs)) {
      event.breadcrumbs = event.breadcrumbs.map((b: AnyEvent) => ({
        ...b,
        message: b?.message ? redactString(String(b.message)) : b?.message,
        data: b?.data ? scrub(b.data) : b?.data,
      }))
    }
    if (event.exception && Array.isArray(event.exception.values)) {
      event.exception.values = event.exception.values.map((v: AnyEvent) => ({
        ...v,
        value: v?.value ? redactString(String(v.value)) : v?.value,
      }))
    }
  } catch {
    // Never let the scrubber itself break Sentry reporting.
  }
  return event
}
