import mongoose, { Schema } from 'mongoose'

// Notification Schema (in-app inbox).
// A notification is addressed either to a single user (userId set) or to
// the whole org (userId null → "anyone in this org sees it"). The latter
// is used for events like cron failures or invite acceptances that any
// admin should be aware of.
const NotificationSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  // null → org-wide announcement; otherwise targets a specific user.
  userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  // Free-form discriminator so the UI can render type-specific icons /
  // colors without us having to migrate enums every time we add a new
  // event class. Examples: "job.failed", "payment.failed",
  // "invite.accepted", "task.due", "dispute.opened".
  kind: { type: String, required: true },
  title: { type: String, required: true },
  body: { type: String, default: '' },
  // Optional same-origin link. UI should only follow paths starting with `/`.
  link: { type: String, default: '' },
  // When set, the notification is read. We keep the row instead of
  // deleting so users can scroll back through history.
  readAt: { type: Date, default: null },
  // Per-user read tracking for org-wide notifications. A user's own
  // ObjectId is appended here when they hit "Mark read" so the same
  // org-wide notification can appear "read" for one admin and unread
  // for another. Per-user notifications ignore this and use `readAt`.
  readByUserIds: { type: [Schema.Types.ObjectId], default: [], index: true },
  metadata: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true })
NotificationSchema.index({ organizationId: 1, createdAt: -1 })
NotificationSchema.index({ organizationId: 1, userId: 1, readAt: 1, createdAt: -1 })

export const Notification =
  mongoose.models.Notification || mongoose.model('Notification', NotificationSchema)
