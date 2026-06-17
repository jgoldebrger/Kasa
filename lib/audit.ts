/**
 * Audit logging for mutations and security-relevant events.
 * Fire-and-forget — failures are logged but do not block the request.
 *
 * Usage (org-scoped):
 *   await audit({
 *     organizationId: ctx.organizationId,
 *     userId: ctx.userId,
 *     action: 'invite.create',
 *     resourceType: 'Invite',
 *     resourceId: invite._id,
 *     metadata: { email, role },
 *   })
 *
 * Usage (platform-level, e.g. failed login):
 *   await audit({
 *     action: 'auth.login.failed',
 *     resourceType: 'User',
 *     metadata: { attemptedEmail: email },
 *     request,        // optional — captures IP + UA
 *   })
 */

import { AuditLog } from './models'

/** Metadata keys that carry email addresses — redacted before persist. */
const EMAIL_METADATA_KEYS =
  /^(email|attemptedEmail|userEmail|fromEmail|toEmail|recipientEmail|senderEmail)$/i

function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return '[redacted-email]'
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  const visible = local.length <= 1 ? '*' : `${local[0]}***`
  return `${visible}@${domain}`
}

function redactAuditMetadata(metadata: unknown): unknown {
  if (metadata == null) return metadata
  if (typeof metadata === 'string') return metadata
  if (Array.isArray(metadata)) return metadata.map(redactAuditMetadata)
  if (typeof metadata !== 'object') return metadata

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
    if (EMAIL_METADATA_KEYS.test(key) && typeof value === 'string') {
      out[key] = maskEmail(value)
    } else if (value != null && typeof value === 'object') {
      out[key] = redactAuditMetadata(value)
    } else {
      out[key] = value
    }
  }
  return out
}

export interface AuditEvent {
  /** Optional for platform-level events (login, signup, password reset). */
  organizationId?: string | null
  /** Optional — failed-login attempts may not have a known user id. */
  userId?: string | null
  action: string
  resourceType: string
  resourceId?: string | any
  metadata?: any
  /** If provided, IP + UA are captured for forensics. */
  request?: Request
}

function getClientIp(req: Request): string | undefined {
  // Trust the same proxy chain we trust elsewhere (see lib/rate-limit).
  // The header set MUST match `lib/rate-limit.ts` — otherwise a
  // Cloudflare-fronted deployment (which sets `cf-connecting-ip` first)
  // shows correct IPs on rate-limit events but blank IPs on audit
  // events, breaking incident forensics.
  const trustProxy = process.env.TRUST_PROXY_HEADERS === 'true' || process.env.VERCEL === '1'
  if (!trustProxy) return undefined
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  const real = req.headers.get('x-real-ip')
  if (real) return real
  const cf = req.headers.get('cf-connecting-ip')
  if (cf) return cf
  return undefined
}

export async function audit(event: AuditEvent): Promise<void> {
  try {
    let ip: string | undefined
    let userAgent: string | undefined
    if (event.request) {
      ip = getClientIp(event.request)
      userAgent = event.request.headers.get('user-agent')?.slice(0, 500) || undefined
    }
    await AuditLog.create({
      organizationId: event.organizationId || undefined,
      userId: event.userId || undefined,
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      metadata: event.metadata ? redactAuditMetadata(event.metadata) : undefined,
      ip,
      userAgent,
    })
  } catch (err) {
    console.error('[audit] Failed to record event:', event.action, err)
  }
}
