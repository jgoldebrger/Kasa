/**
 * Edge-safe cron secret verification. Used by middleware (auth.config)
 * and re-exported from lib/auth-cron.ts for route handlers.
 */

/**
 * Verify an incoming request is from a trusted cron trigger.
 *
 * Trust signals (any of):
 *  1. `x-cron-secret` header equals `process.env.CRON_SECRET` (constant-time).
 *  2. `Authorization: Bearer <CRON_SECRET>` header (Vercel Cron's default).
 *
 * Returns `false` if `CRON_SECRET` is unset (no implicit trust).
 */
export function isCronRequest(request: Request): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false

  const headerSecret = request.headers.get('x-cron-secret')
  if (headerSecret && safeEqual(headerSecret, expected)) return true

  const auth = request.headers.get('authorization')
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim()
    if (token && safeEqual(token, expected)) return true
  }

  return false
}

/** Constant-time string compare. Edge-safe (no node:crypto). */
function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) {
    const ac = i < a.length ? a.charCodeAt(i) : 0
    const bc = i < b.length ? b.charCodeAt(i) : 0
    diff |= ac ^ bc
  }
  return diff === 0
}
