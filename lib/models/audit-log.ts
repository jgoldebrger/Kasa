import mongoose, { Schema } from 'mongoose'

const AuditLogSchema = new Schema(
  {
    // Optional: platform-level events (login attempts, signups, password
    // resets, platform-admin actions) have no organization context.
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', index: true },
    // Optional: failed-login attempts may not have a known user id; we
    // still want to record the attempted email in metadata for forensics.
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, required: true, index: true },
    resourceType: { type: String, required: true },
    resourceId: { type: Schema.Types.ObjectId },
    metadata: Schema.Types.Mixed,
    // IP + UA for security-relevant events (login, password reset, etc).
    ip: String,
    userAgent: String,
  },
  { timestamps: true },
)
AuditLogSchema.index({ organizationId: 1, createdAt: -1 })
AuditLogSchema.index({ action: 1, createdAt: -1 })
// Retain audit rows for ~13 months. Long enough to cover annual
// compliance reviews and "what happened last fiscal year?" lookups,
// short enough that the collection doesn't grow unbounded — every
// mutation (and every failed login attempt) writes a row here, so on
// a busy org this can grow into the millions per year. The TTL
// monitor sweeps based on `createdAt` (auto-stamped by `timestamps`).
// Adjust the retention by changing AUDIT_LOG_RETENTION_DAYS; existing
// rows will then expire on the next monitor pass.
export const AUDIT_LOG_RETENTION_DAYS = 400
export const AUDIT_LOG_RETENTION_SECONDS = 60 * 60 * 24 * AUDIT_LOG_RETENTION_DAYS

AuditLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: AUDIT_LOG_RETENTION_SECONDS, name: 'audit_log_ttl' },
)

export const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', AuditLogSchema)
