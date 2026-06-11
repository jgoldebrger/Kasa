/** Fields safe to return on payment list/detail API responses. */
export const PAYMENT_PUBLIC_SELECT =
  '_id familyId memberId amount paymentDate year type paymentMethod ' +
  'ccInfo checkInfo notes paymentFrequency createdAt refundedAmount refundedAt ' +
  'disputedAt disputeStatus'
