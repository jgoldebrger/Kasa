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
      metadata: event.metadata,
      ip,
      userAgent,
    })
  } catch (err) {
    console.error('[audit] Failed to record event:', event.action, err)
  }
}
