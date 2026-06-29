/**
 * Per-organization activity / audit-log settings.
 *
 * GET   /api/organizations/activity — retention policy for Settings → Activity.
 * PATCH /api/organizations/activity — owner updates audit log retention days.
 */

import { z } from 'zod'
import { handler } from '@/lib/api/handler'
import { Organization } from '@/lib/models'
import { audit } from '@/lib/audit'
import { checkRateLimit } from '@/lib/rate-limit'
import {
  AUDIT_LOG_RETENTION_MAX_DAYS,
  AUDIT_LOG_RETENTION_MIN_DAYS,
  resolveAuditLogRetentionDays,
} from '@/lib/audit-log-retention'
import { AUDIT_LOG_RETENTION_DAYS } from '@/lib/models/audit-log'
import {
  DEFAULT_ORG_BULK_RATE_LIMITS,
  resolveOrgBulkRateLimit,
  type OrgBulkOperation,
} from '@/lib/org-bulk-rate-limit'

export const dynamic = 'force-dynamic'

const patchBody = z.object({
  auditLogRetentionDays: z
    .number()
    .int()
    .min(AUDIT_LOG_RETENTION_MIN_DAYS)
    .max(AUDIT_LOG_RETENTION_MAX_DAYS)
    .nullable(),
})

type OrgActivityLean = {
  auditLogRetentionDays?: number | null
  rateLimits?: {
    importPerHour?: number | null
    sendBulkPerHour?: number | null
    exportPerHour?: number | null
  } | null
}

function activityPayload(org: OrgActivityLean) {
  const rateLimits = org.rateLimits || {}
  const bulkLimits = (['import', 'send-bulk', 'export'] as OrgBulkOperation[]).reduce(
    (acc, op) => {
      acc[op] = resolveOrgBulkRateLimit(op, rateLimits)
      return acc
    },
    {} as Record<OrgBulkOperation, number>,
  )

  return {
    auditLogRetentionDays: org.auditLogRetentionDays ?? null,
    effectiveRetentionDays: resolveAuditLogRetentionDays(org),
    platformDefaultRetentionDays: AUDIT_LOG_RETENTION_DAYS,
    minRetentionDays: AUDIT_LOG_RETENTION_MIN_DAYS,
    maxRetentionDays: AUDIT_LOG_RETENTION_MAX_DAYS,
    bulkRateLimitsPerHour: bulkLimits,
    defaultBulkRateLimitsPerHour: DEFAULT_ORG_BULK_RATE_LIMITS,
  }
}

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/organizations/activity',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'org-activity-get',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const org = await Organization.findById(ctx!.organizationId)
      .select('auditLogRetentionDays rateLimits')
      .lean<OrgActivityLean>()
    if (!org) return { status: 404, data: { error: 'Organization not found' } }

    return {
      data: activityPayload(org),
      headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=300' },
    }
  },
})

export const PATCH = handler({
  auth: 'org',
  minRole: 'owner',
  body: patchBody,
  name: 'PATCH /api/organizations/activity',
  fn: async ({ ctx, body, session, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'org-activity-patch',
      { limit: 30, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const updated = await Organization.findByIdAndUpdate(
      ctx!.organizationId,
      { $set: { auditLogRetentionDays: body.auditLogRetentionDays } },
      { new: true },
    )
      .select('auditLogRetentionDays rateLimits')
      .lean<OrgActivityLean>()
    if (!updated) return { status: 404, data: { error: 'Organization not found' } }

    await audit({
      organizationId: ctx!.organizationId,
      userId: session!.user.id,
      action: 'org.settings.update',
      resourceType: 'Organization',
      resourceId: ctx!.organizationId,
      metadata: { fields: ['auditLogRetentionDays'] },
      request,
    })

    return { data: activityPayload(updated) }
  },
})
