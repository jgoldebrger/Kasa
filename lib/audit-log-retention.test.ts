import { describe, expect, it } from 'vitest'
import {
  AUDIT_LOG_RETENTION_MAX_DAYS,
  AUDIT_LOG_RETENTION_MIN_DAYS,
  isValidAuditLogRetentionDays,
  resolveAuditLogRetentionDays,
} from '@/lib/audit-log-retention'
import { AUDIT_LOG_RETENTION_DAYS } from '@/lib/models/audit-log'

describe('audit-log-retention', () => {
  it('defaults to platform TTL days when org has no override', () => {
    expect(resolveAuditLogRetentionDays(null)).toBe(AUDIT_LOG_RETENTION_DAYS)
    expect(resolveAuditLogRetentionDays({})).toBe(AUDIT_LOG_RETENTION_DAYS)
    expect(AUDIT_LOG_RETENTION_DAYS).toBe(400)
    expect(AUDIT_LOG_RETENTION_MAX_DAYS).toBe(400)
  })

  it('clamps owner overrides within bounds', () => {
    expect(resolveAuditLogRetentionDays({ auditLogRetentionDays: 180 })).toBe(180)
    expect(resolveAuditLogRetentionDays({ auditLogRetentionDays: 30 })).toBe(
      AUDIT_LOG_RETENTION_MIN_DAYS,
    )
    expect(resolveAuditLogRetentionDays({ auditLogRetentionDays: 999 })).toBe(
      AUDIT_LOG_RETENTION_MAX_DAYS,
    )
  })

  it('validates retention day input', () => {
    expect(isValidAuditLogRetentionDays(120)).toBe(true)
    expect(isValidAuditLogRetentionDays(89)).toBe(false)
    expect(isValidAuditLogRetentionDays(401)).toBe(false)
    expect(isValidAuditLogRetentionDays('120')).toBe(false)
  })
})
