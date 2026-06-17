/**
 * Per-job HMAC tokens for cron continuation URLs.
 *
 * Vercel Cron may still use the global `CRON_SECRET` bearer. Internal
 * self-calls (chunked job continuations, org-scoped workers) should
 * sign a short-lived token bound to job name and optional organizationId.
 */

import crypto from 'node:crypto'
import { isCronRequest } from '@/lib/auth-cron-verify'

const ALGO = 'sha256'
/** Default TTL for continuation tokens (1 hour). */
export const DEFAULT_CRON_JOB_TOKEN_TTL_MS = 60 * 60 * 1000

export interface SignCronJobParams {
  jobName: string
  organizationId?: string
  expiresAt: number
}

interface CronJobPayload {
  jobName: string
  organizationId?: string
  exp: number
}

export function signCronJob(params: SignCronJobParams): string {
  const secret = process.env.CRON_SECRET
  if (!secret) throw new Error('CRON_SECRET is not set')

  const payload: CronJobPayload = {
    jobName: params.jobName,
    exp: params.expiresAt,
  }
  if (params.organizationId) payload.organizationId = params.organizationId

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac(ALGO, secret).update(payloadB64).digest('base64url')
  return `${payloadB64}.${sig}`
}

function parseToken(
  token: string,
): { payload: CronJobPayload; payloadB64: string; sig: string } | null {
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const payloadB64 = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (!payloadB64 || !sig) return null
  try {
    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    ) as CronJobPayload
    if (typeof payload.jobName !== 'string' || typeof payload.exp !== 'number') return null
    if (payload.organizationId !== undefined && typeof payload.organizationId !== 'string')
      return null
    return { payload, payloadB64, sig }
  } catch {
    return null
  }
}

function verifySignature(payloadB64: string, sig: string, secret: string): boolean {
  const expected = crypto.createHmac(ALGO, secret).update(payloadB64).digest('base64url')
  if (expected.length !== sig.length) return false
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
}

/**
 * Accept global cron secret (Vercel) or a signed per-job token via
 * `x-cron-job-token` header or `jobToken` query param.
 *
 * When the request URL includes `organizationId`, the token payload
 * must include the same value.
 */
export function verifyCronJob(request: Request, expectedJobName: string): boolean {
  if (isCronRequest(request)) return true

  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const token =
    request.headers.get('x-cron-job-token')?.trim() ||
    new URL(request.url).searchParams.get('jobToken')?.trim()
  if (!token) return false

  const parsed = parseToken(token)
  if (!parsed) return false
  if (!verifySignature(parsed.payloadB64, parsed.sig, secret)) return false

  const { payload } = parsed
  if (payload.jobName !== expectedJobName) return false
  if (payload.exp < Date.now()) return false

  const urlOrgId = new URL(request.url).searchParams.get('organizationId')?.trim()
  if (urlOrgId) {
    if (!payload.organizationId || payload.organizationId !== urlOrgId) return false
  }

  return true
}
