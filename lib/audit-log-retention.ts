/**
 * Audit log retention policy — shared between the Mongo TTL index,
 * Settings → Activity UI, and the audit-log read/export endpoints.
 */

import { AUDIT_LOG_RETENTION_DAYS } from '@/lib/models/audit-log'

/** Owners may request shorter retention but not below this floor. */
export const AUDIT_LOG_RETENTION_MIN_DAYS = 90

/** Platform ceiling — matches the Mongo TTL index on AuditLog.createdAt. */
export const AUDIT_LOG_RETENTION_MAX_DAYS = AUDIT_LOG_RETENTION_DAYS

export type AuditLogRetentionSettings = {
  auditLogRetentionDays?: number | null
}

export function resolveAuditLogRetentionDays(org?: AuditLogRetentionSettings | null): number {
  const raw = org?.auditLogRetentionDays
  if (raw == null || !Number.isFinite(raw)) return AUDIT_LOG_RETENTION_DAYS
  return Math.min(
    AUDIT_LOG_RETENTION_MAX_DAYS,
    Math.max(AUDIT_LOG_RETENTION_MIN_DAYS, Math.floor(raw)),
  )
}

export function auditLogRetentionCutoff(org?: AuditLogRetentionSettings | null): Date {
  const days = resolveAuditLogRetentionDays(org)
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

export function isValidAuditLogRetentionDays(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  const n = Math.floor(value)
  return n >= AUDIT_LOG_RETENTION_MIN_DAYS && n <= AUDIT_LOG_RETENTION_MAX_DAYS
}
