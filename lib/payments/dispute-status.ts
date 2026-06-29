/** Stripe dispute statuses that still need admin attention. */
export const OPEN_DISPUTE_STATUSES = [
  'warning_needs_response',
  'warning_under_review',
  'needs_response',
  'under_review',
] as const

/** Terminal Stripe dispute outcomes. */
export const CLOSED_DISPUTE_STATUSES = ['won', 'lost', 'warning_closed', 'charge_refunded'] as const

export type DisputeFilter = 'open' | 'closed' | 'all'

export function isOpenDisputeStatus(status?: string | null): boolean {
  if (!status) return true
  return (OPEN_DISPUTE_STATUSES as readonly string[]).includes(status)
}

export function disputeMongoFilter(status: DisputeFilter): Record<string, unknown> {
  const base = { disputedAt: { $ne: null } }
  if (status === 'all') return base
  if (status === 'open') {
    return {
      ...base,
      $or: [
        { disputeStatus: { $in: [...OPEN_DISPUTE_STATUSES] } },
        { disputeStatus: { $exists: false } },
        { disputeStatus: null },
      ],
    }
  }
  return {
    ...base,
    disputeStatus: { $in: [...CLOSED_DISPUTE_STATUSES] },
  }
}
