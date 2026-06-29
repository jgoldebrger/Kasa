/**
 * Per-organization hourly rate limits for bulk operations (import,
 * send-bulk, org export). Limits are keyed by organization id so one
 * noisy tenant cannot exhaust shared IP buckets.
 *
 * Defaults come from env; each org may override via Organization.rateLimits.
 */

import { checkRateLimit, type RateLimitVerdict } from '@/lib/rate-limit'

export type OrgBulkOperation = 'import' | 'send-bulk' | 'export'

export type OrgRateLimitOverrides = {
  importPerHour?: number | null
  sendBulkPerHour?: number | null
  exportPerHour?: number | null
}

const HOUR_MS = 60 * 60_000

const SCOPE_BY_OPERATION: Record<OrgBulkOperation, string> = {
  import: 'import',
  'send-bulk': 'email-send-bulk',
  export: 'org-export',
}

function envLimit(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

export const DEFAULT_ORG_BULK_RATE_LIMITS: Record<OrgBulkOperation, number> = {
  import: envLimit('ORG_RATE_LIMIT_IMPORT_PER_HOUR', 10),
  'send-bulk': envLimit('ORG_RATE_LIMIT_SEND_BULK_PER_HOUR', 10),
  export: envLimit('ORG_RATE_LIMIT_EXPORT_PER_HOUR', 5),
}

export function resolveOrgBulkRateLimit(
  operation: OrgBulkOperation,
  overrides?: OrgRateLimitOverrides | null,
): number {
  const fallback = DEFAULT_ORG_BULK_RATE_LIMITS[operation]
  if (!overrides) return fallback

  const raw =
    operation === 'import'
      ? overrides.importPerHour
      : operation === 'send-bulk'
        ? overrides.sendBulkPerHour
        : overrides.exportPerHour

  if (raw == null || !Number.isFinite(raw)) return fallback
  const n = Math.floor(raw)
  return n > 0 ? n : fallback
}

export async function checkOrgBulkRateLimit(
  request: Request,
  organizationId: string,
  operation: OrgBulkOperation,
  overrides?: OrgRateLimitOverrides | null,
): Promise<RateLimitVerdict> {
  const limit = resolveOrgBulkRateLimit(operation, overrides)
  const scope = SCOPE_BY_OPERATION[operation]
  const failClosed = operation === 'import' || operation === 'send-bulk'

  return checkRateLimit(request, scope, { limit, windowMs: HOUR_MS, failClosed }, organizationId)
}

/** Seconds until the rate-limit window resets (minimum 1). */
export function retryAfterSeconds(resetAt: number, now = Date.now()): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1000))
}

export function orgBulkRateLimitHeaders(verdict: RateLimitVerdict): Record<string, string> {
  return { 'Retry-After': String(retryAfterSeconds(verdict.resetAt)) }
}

export function orgBulkRateLimit429(
  verdict: RateLimitVerdict,
  error = 'Too many requests. Try again later.',
): { status: 429; data: { error: string }; headers: Record<string, string> } {
  return {
    status: 429,
    data: { error },
    headers: orgBulkRateLimitHeaders(verdict),
  }
}
