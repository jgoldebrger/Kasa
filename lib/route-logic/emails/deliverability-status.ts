import { EmailConfig, Organization } from '@/lib/models'
import type { OrgPhysicalAddress } from '@/lib/mail/email-wrapper'
import { checkRateLimit } from '@/lib/rate-limit'
import { handler } from '@/lib/api/handler'
import { getEmailQuota } from './quota'

export type DeliverabilityCheckStatus = 'pass' | 'warn' | 'fail'

export interface DeliverabilityCheck {
  status: DeliverabilityCheckStatus
  /** Underlying boolean for the check (pass = true). */
  ok: boolean
}

export interface DeliverabilityStatus {
  smtpConfigured: DeliverabilityCheck
  smtpVerifiedRecently: DeliverabilityCheck
  replyToSet: DeliverabilityCheck
  physicalAddressSet: DeliverabilityCheck
  quotaHeadroom: DeliverabilityCheck
  quota: { sentToday: number; limit: number; remaining: number }
  lastTestAt: string | null
  lastTestStatus: 'success' | 'failed' | null
}

const SMTP_VERIFY_RECENT_MS = 14 * 24 * 60 * 60 * 1000
const QUOTA_WARN_FRACTION = 0.1

function hasPhysicalAddress(letterhead?: OrgPhysicalAddress | null): boolean {
  if (!letterhead) return false
  return Boolean(
    letterhead.addressLine1?.trim() ||
    letterhead.addressLine2?.trim() ||
    letterhead.city?.trim() ||
    letterhead.state?.trim() ||
    letterhead.zip?.trim(),
  )
}

function smtpVerifiedRecentlyStatus(
  configured: boolean,
  lastTestAt: Date | null | undefined,
  lastTestStatus: 'success' | 'failed' | null | undefined,
): DeliverabilityCheck {
  if (!configured) {
    return { status: 'fail', ok: false }
  }
  if (lastTestStatus === 'failed') {
    return { status: 'fail', ok: false }
  }
  if (!lastTestAt || lastTestStatus !== 'success') {
    return { status: 'warn', ok: false }
  }
  const ageMs = Date.now() - lastTestAt.getTime()
  if (ageMs <= SMTP_VERIFY_RECENT_MS) {
    return { status: 'pass', ok: true }
  }
  return { status: 'warn', ok: false }
}

function quotaHeadroomStatus(remaining: number, limit: number): DeliverabilityCheck {
  if (remaining <= 0) {
    return { status: 'fail', ok: false }
  }
  const warnThreshold = Math.max(1, Math.floor(limit * QUOTA_WARN_FRACTION))
  if (remaining <= warnThreshold) {
    return { status: 'warn', ok: false }
  }
  return { status: 'pass', ok: true }
}

export async function getDeliverabilityStatus(
  organizationId: string,
): Promise<DeliverabilityStatus> {
  const [config, org, quota] = await Promise.all([
    EmailConfig.findOne({ isActive: true, organizationId }).lean<{
      replyTo?: string
      lastTestAt?: Date
      lastTestStatus?: 'success' | 'failed'
    }>(),
    Organization.findById(organizationId)
      .select('letterhead')
      .lean<{ letterhead?: OrgPhysicalAddress }>(),
    getEmailQuota(organizationId),
  ])

  const smtpConfigured = Boolean(config)
  const replyToSet = Boolean(config?.replyTo?.trim())
  const physicalAddressSet = hasPhysicalAddress(org?.letterhead)

  return {
    smtpConfigured: {
      status: smtpConfigured ? 'pass' : 'fail',
      ok: smtpConfigured,
    },
    smtpVerifiedRecently: smtpVerifiedRecentlyStatus(
      smtpConfigured,
      config?.lastTestAt,
      config?.lastTestStatus ?? null,
    ),
    replyToSet: {
      status: replyToSet ? 'pass' : 'warn',
      ok: replyToSet,
    },
    physicalAddressSet: {
      status: physicalAddressSet ? 'pass' : 'fail',
      ok: physicalAddressSet,
    },
    quotaHeadroom: quotaHeadroomStatus(quota.remaining, quota.limit),
    quota,
    lastTestAt: config?.lastTestAt?.toISOString() ?? null,
    lastTestStatus: config?.lastTestStatus ?? null,
  }
}

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/emails/deliverability-status',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'email-deliverability-status',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const status = await getDeliverabilityStatus(ctx!.organizationId)
    return {
      data: status,
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=300' },
    }
  },
})
