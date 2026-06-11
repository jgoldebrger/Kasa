import mongoose, { Schema } from 'mongoose'

// Stripe Webhook Event Schema — idempotency log for inbound webhooks.
// Stripe retries delivery on any non-2xx (or just because) and the
// "delivered" guarantee is at-least-once. Without dedup, handlers like
// `charge.dispute.created` would re-create the admin Task and re-fire
// the notification on every retry. We store `event.id` (e.g.
// `evt_…`) with a TTL so the log doesn't grow unbounded — 7 days is
// more than enough for Stripe's retry window (currently up to 3 days).
const StripeWebhookEventSchema = new Schema({
  eventId: { type: String, required: true, unique: true, index: true },
  type: { type: String, required: true },
  processedAt: { type: Date, default: Date.now, required: true },
  // TTL — Mongo sweeps this row 7 days after processing.
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 },
  },
})

export const StripeWebhookEvent =
  mongoose.models.StripeWebhookEvent ||
  mongoose.model('StripeWebhookEvent', StripeWebhookEventSchema)
