/**

 * Distributed rate limiter with optional Upstash Redis backend.

 *

 * Backend selection (first match wins):

 *   1. Upstash Redis when `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set

 *      (~1ms REST round trip, no Mongo writes on hot paths).

 *   2. MongoDB otherwise (zero new infra; ~3–10ms per check via atomic $inc + TTL).

 *

 * Org-scoped read exemptions (no checkRateLimit call in route handlers):

 *   - `families-list` — GET /api/families

 *   - `dashboard-stats` — GET /api/dashboard-stats
 *
 *   - `dashboard-actions` — GET /api/dashboard-actions

 * These require org auth and tenant isolation via ctx.organizationId. They were

 * the highest-traffic Mongo rate-limit writers; abuse is bounded by session auth.

 *

 * Usage:

 *   const verdict = await checkRateLimit(request, 'login', { limit: 5, windowMs: 15 * 60_000 })

 *   if (!verdict.allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

 *

 *   // Optional secondary key, e.g. attempted email, for IP-rotation resistance:

 *   const v2 = await checkRateLimit(request, 'login', { limit: 10, windowMs: 60 * 60_000 }, email)

 */

import { Ratelimit } from '@upstash/ratelimit'

import { Redis } from '@upstash/redis'

import mongoose, { Schema } from 'mongoose'

import connectDB from '@/lib/database'

/** Documented exempt scopes — see module header. */

export const ORG_SCOPED_READ_EXEMPT_SCOPES = [
  'families-list',
  'dashboard-stats',
  'dashboard-actions',
] as const

interface RateLimitDoc {
  _id: string

  count: number

  windowStart: Date

  expiresAt: Date
}

const RateLimitSchema = new Schema<RateLimitDoc>(
  {
    _id: { type: String, required: true },

    count: { type: Number, default: 0 },

    windowStart: { type: Date, required: true },

    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { _id: false, versionKey: false },
)

const RateLimit =
  (mongoose.models.RateLimit as mongoose.Model<RateLimitDoc>) ||
  mongoose.model<RateLimitDoc>('RateLimit', RateLimitSchema)

const TRUST_PROXY = process.env.TRUST_PROXY_HEADERS === 'true' || process.env.VERCEL === '1'

let redisClient: Redis | null = null

const redisLimiterCache = new Map<string, Ratelimit>()

function isRedisBackendEnabled(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
}

function getRedis(): Redis {
  if (!redisClient) {
    redisClient = Redis.fromEnv()
  }

  return redisClient
}

function getRedisLimiter(scope: string, opts: RateLimitOptions): Ratelimit {
  const cacheKey = `${scope}:${opts.limit}:${opts.windowMs}`

  let limiter = redisLimiterCache.get(cacheKey)

  if (!limiter) {
    limiter = new Ratelimit({
      redis: getRedis(),

      limiter: Ratelimit.fixedWindow(opts.limit, `${opts.windowMs} ms`),

      prefix: `kasa:rl:${scope}`,

      analytics: false,
    })

    redisLimiterCache.set(cacheKey, limiter)
  }

  return limiter
}

function getClientIp(req: Request): string | null {
  if (!TRUST_PROXY) return null

  const headers = req.headers

  const xff = headers.get('x-forwarded-for')

  if (xff) {
    const first = xff.split(',')[0].trim()

    if (first) return first
  }

  return headers.get('x-real-ip') || headers.get('cf-connecting-ip') || null
}

export interface RateLimitOptions {
  limit: number

  windowMs: number

  /**

   * If true, an infrastructure failure (Mongo/Redis down, etc.) is treated as

   * a deny. Default false — for most rate-limited paths a brief backend blip

   * should not lock everyone out. Auth-critical scopes (`login*`, `pwd-reset*`),

   * `import`, and email-send scopes override this.

   */

  failClosed?: boolean
}

export interface RateLimitVerdict {
  allowed: boolean

  remaining: number

  resetAt: number
}

/** Scopes that trigger outbound email — fail-closed on backend errors. */

const EMAIL_SEND_SCOPES = new Set([
  'send-file-email',

  'send-monthly-emails',

  'send-statement-emails',

  'send-single-email',

  'statement-email-worker',

  'tax-receipt-email',

  'tax-receipt-email-worker',

  'email-config-test',

  'task-due-emails',
])

export function isEmailSendScope(scope: string): boolean {
  return EMAIL_SEND_SCOPES.has(scope)
}

export function isFailClosedScope(scope: string, opts?: RateLimitOptions): boolean {
  if (opts?.failClosed) return true

  if (
    scope === 'login' ||
    scope === 'login-email' ||
    scope === 'signup' ||
    scope === 'precheck-2fa' ||
    scope === 'precheck-2fa-email' ||
    scope === '2fa-change' ||
    scope === '2fa-setup' ||
    scope === 'import'
  ) {
    return true
  }

  if (scope.startsWith('pwd-reset')) return true

  if (isEmailSendScope(scope)) return true

  return false
}

function buildRateLimitKey(
  req: Request,

  scope: string,

  extraKey?: string,
): { key: string; identifier: string } {
  const ip = getClientIp(req)

  const principal = ip || (extraKey ? `id:${String(extraKey).toLowerCase()}` : 'shared')

  const parts = [scope, principal]

  if (extraKey && ip) parts.push(String(extraKey).toLowerCase())

  const key = parts.join(':')

  const identifierParts = [principal]

  if (extraKey && ip) identifierParts.push(String(extraKey).toLowerCase())

  return { key, identifier: identifierParts.join(':') }
}

function failVerdict(
  opts: RateLimitOptions,

  scope: string,

  now: number,
): RateLimitVerdict {
  if (isFailClosedScope(scope, opts)) {
    return { allowed: false, remaining: 0, resetAt: now + opts.windowMs }
  }

  return { allowed: true, remaining: opts.limit - 1, resetAt: now + opts.windowMs }
}

async function checkRateLimitRedis(
  scope: string,

  identifier: string,

  opts: RateLimitOptions,

  now: number,
): Promise<RateLimitVerdict> {
  const limiter = getRedisLimiter(scope, opts)

  const result = await limiter.limit(identifier)

  return {
    allowed: result.success,

    remaining: result.remaining,

    resetAt: result.reset,
  }
}

async function checkRateLimitMongo(
  key: string,

  opts: RateLimitOptions,

  now: number,
): Promise<RateLimitVerdict> {
  await connectDB()

  const doc = await RateLimit.findOneAndUpdate(
    { _id: key },

    {
      $inc: { count: 1 },

      $setOnInsert: {
        windowStart: new Date(now),

        expiresAt: new Date(now + opts.windowMs),
      },
    },

    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean<RateLimitDoc>()

  if (!doc) {
    return { allowed: true, remaining: opts.limit - 1, resetAt: now + opts.windowMs }
  }

  const resetAt = new Date(doc.expiresAt).getTime()

  if (doc.count > opts.limit) {
    return { allowed: false, remaining: 0, resetAt }
  }

  return {
    allowed: true,

    remaining: Math.max(0, opts.limit - doc.count),

    resetAt,
  }
}

export async function checkRateLimit(
  req: Request,

  scope: string,

  opts: RateLimitOptions,

  extraKey?: string,
): Promise<RateLimitVerdict> {
  const { key, identifier } = buildRateLimitKey(req, scope, extraKey)

  const now = Date.now()

  try {
    if (isRedisBackendEnabled()) {
      return await checkRateLimitRedis(scope, identifier, opts, now)
    }

    return await checkRateLimitMongo(key, opts, now)
  } catch (err) {
    const forceClosed = isFailClosedScope(scope, opts)

    console.error(
      `[rate-limit] fallback (fail-${forceClosed ? 'closed' : 'open'}) scope=${scope} backend=${isRedisBackendEnabled() ? 'redis' : 'mongo'}:`,

      (err as Error)?.message,
    )

    return failVerdict(opts, scope, now)
  }
}
