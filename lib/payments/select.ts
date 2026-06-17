import { sanitizePaymentNotes } from './sanitize'

/** Fields safe to return on payment list/detail API responses. */
export const PAYMENT_PUBLIC_SELECT =
  '_id familyId memberId amount paymentDate year type paymentMethod ' +
  'ccInfo checkInfo notes paymentFrequency createdAt refundedAmount refundedAt ' +
  'disputedAt disputeStatus'

/** Redact Stripe ids from payment notes before JSON serialization. */
export function serializePaymentPublic<T>(payment: T): T {
  if (payment == null || typeof payment !== 'object' || Array.isArray(payment)) {
    return payment
  }
  const notes = (payment as { notes?: string | null }).notes
  if (notes == null || notes === '') return payment
  return { ...payment, notes: sanitizePaymentNotes(notes) }
}

export function serializePaymentsPublic<T>(payments: T[]): T[] {
  return payments.map(serializePaymentPublic)
}
