import mongoose, { Schema } from 'mongoose'
import { softDeletePlugin } from './soft-delete-plugin'

const PaymentSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
  memberId: { type: Schema.Types.ObjectId, ref: 'FamilyMember' }, // Optional: for member-specific payments
  // Payments are always positive — corrections/reversals are recorded
  // via `refundedAmount` or a `Withdrawal`, NOT a negative payment.
  amount: { type: Number, required: true, min: 0 },
  paymentDate: { type: Date, required: true },
  year: Number, // Year for calculation purposes
  // Free-form payment category. Enum-constrained so a bad import / script
  // can't sneak in a typo'd value that calculations / filters silently
  // miss. New types can be added by updating this list.
  type: { type: String, enum: ['membership', 'donation', 'other'] },
  paymentMethod: { 
    type: String, 
    enum: ['cash', 'credit_card', 'check', 'quick_pay'],
    default: 'cash'
  },
  // Credit Card Information
  ccInfo: {
    last4: String, // Last 4 digits of card
    cardType: String, // Visa, Mastercard, etc.
    expiryMonth: String,
    expiryYear: String,
    nameOnCard: String
  },
  // Check Information
  checkInfo: {
    checkNumber: String,
    bankName: String,
    routingNumber: String
  },
  // Stripe Integration
  stripePaymentIntentId: String, // Stripe payment intent ID for credit card payments
  savedPaymentMethodId: { type: Schema.Types.ObjectId, ref: 'SavedPaymentMethod' }, // Reference to saved payment method if used
  recurringPaymentId: { type: Schema.Types.ObjectId, ref: 'RecurringPayment' }, // Reference to recurring payment if part of subscription
  paymentFrequency: { type: String, enum: ['one-time', 'monthly'], default: 'one-time' }, // Payment frequency
  // Stripe webhook outcomes — populated by /api/stripe/webhook when a
  // refund or dispute lands. Kept as an additive metadata layer so the
  // balance math (which sums Payment.amount) stays untouched until an
  // admin decides to soft-delete or adjust the row.
  refundedAt: Date,
  refundedAmount: { type: Number, min: 0 },
  disputedAt: Date,
  // Mirrors Stripe's `dispute.status` values. Loose `String` previously
  // let any free-form text land here.
  disputeStatus: {
    type: String,
    enum: [
      'warning_needs_response',
      'warning_under_review',
      'warning_closed',
      'needs_response',
      'under_review',
      'won',
      'lost',
      'charge_refunded',
    ],
  },
  notes: String,
}, { timestamps: true })
PaymentSchema.index({ organizationId: 1, paymentDate: -1 })
PaymentSchema.index({ organizationId: 1, familyId: 1, paymentDate: -1 })
PaymentSchema.index({ organizationId: 1, familyId: 1, year: 1 })
// Idempotency: per-org unique Stripe PaymentIntent ID. Stripe webhook
// handlers and the recurring-payment cron both look up payments by
// `stripePaymentIntentId`; the unique partial index also stops double
// inserts when an admin clicks "Confirm" twice or Stripe retries the
// webhook. Partial so legacy / cash / check payments (no Stripe ID)
// don't all collide on `null`.
PaymentSchema.index(
  { organizationId: 1, stripePaymentIntentId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      stripePaymentIntentId: { $type: 'string' },
      deletedAt: null,
    },
  },
)
// Webhook lookups are global by intent ID; back the lookup with an
// index so refund/dispute handlers don't full-scan Payments at scale.
PaymentSchema.index(
  { stripePaymentIntentId: 1 },
  {
    partialFilterExpression: { stripePaymentIntentId: { $type: 'string' } },
  },
)
PaymentSchema.plugin(softDeletePlugin)

export const Payment = mongoose.models.Payment || mongoose.model('Payment', PaymentSchema)
