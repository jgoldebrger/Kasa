/**
 * Statement-period math, shared across all four places that generate a
 * statement (POST /api/statements, /api/statements/generate-monthly,
 * lib/scheduler.ts, lib/statements/send-statement.ts).
 *
 * Loads every flow type that affects the family's balance for the
 * given window, returns both the raw rows (for transaction listings)
 * and the aggregates the Statement doc stores.
 */

import { Payment, Withdrawal, LifecycleEventPayment, CycleCharge } from '@/lib/models'
import { UNBOUNDED_LIST_CAP } from '@/lib/schemas/common'
import { calculateFamilyBalance } from '@/lib/calculations'
import { sanitizePaymentNotes } from '@/lib/payments/sanitize'
import { loadAllByIdCursor } from '@/lib/org-pagination'

export interface StatementPeriodInputs {
  organizationId: string
  familyId: string
  fromDate: Date
  toDate: Date
  openingBalance: number
}

export interface StatementPeriodAggregates {
  payments: any[]
  /** Refunds during the window on payments made before `fromDate`. */
  priorPeriodRefunds: any[]
  withdrawals: any[]
  lifecycleEvents: any[]
  cycleCharges: any[]
  totalIncome: number
  totalWithdrawals: number
  totalExpenses: number
  totalCycleCharges: number
  closingBalance: number
}

/**
 * Load the four ledgers for `[fromDate, toDate]` and compute the
 * Statement-row aggregates. Each ledger is returned sorted ascending
 * by its event date so callers can splice them into a single ordered
 * transaction list without re-sorting.
 *
 * Closing-balance formula:
 *     closingBalance = openingBalance
 *                    + totalIncome           // payments
 *                    - totalWithdrawals      // withdrawals
 *                    - totalCycleCharges     // annual dues captured at cycle rollover
 *
 * Lifecycle events are intentionally NOT subtracted — they're
 * informational on the statement and tracked separately in
 * yearly-calculation. This matches the long-standing semantics of
 * `Statement.closingBalance`.
 */
export async function loadStatementPeriod(
  input: StatementPeriodInputs,
): Promise<StatementPeriodAggregates> {
  const { organizationId, familyId, fromDate, toDate, openingBalance } = input

  const orgFamilyFilter = { organizationId, familyId }

  const [payments, priorPeriodRefunds, withdrawals, lifecycleEvents, cycleCharges] =
    await Promise.all([
    loadAllByIdCursor<any>(
      (filter, limit) =>
        Payment.find(filter)
          .sort({ paymentDate: 1, _id: 1 })
          .limit(limit)
          .lean<any[]>()
          .then((rows) =>
            rows.map((p) => ({
              ...p,
              netAmount: Math.max(0, Number(p.amount || 0) - Number(p.refundedAmount || 0)),
            })),
          ),
      { ...orgFamilyFilter, paymentDate: { $gte: fromDate, $lte: toDate } },
    ),
    loadAllByIdCursor<any>(
      (filter, limit) =>
        Payment.find(filter)
          .select('amount refundedAmount refundedAt type notes paymentDate')
          .sort({ refundedAt: 1, _id: 1 })
          .limit(limit)
          .lean<any[]>(),
      {
        ...orgFamilyFilter,
        paymentDate: { $lt: fromDate },
        refundedAt: { $gte: fromDate, $lte: toDate },
        refundedAmount: { $gt: 0 },
      },
    ),
    loadAllByIdCursor<any>(
      (filter, limit) =>
        Withdrawal.find(filter)
          .sort({ withdrawalDate: 1, _id: 1 })
          .limit(limit)
          .lean<any[]>(),
      { ...orgFamilyFilter, withdrawalDate: { $gte: fromDate, $lte: toDate } },
    ),
    loadAllByIdCursor<any>(
      (filter, limit) =>
        LifecycleEventPayment.find(filter)
          .sort({ eventDate: 1, _id: 1 })
          .limit(limit)
          .lean<any[]>(),
      { ...orgFamilyFilter, eventDate: { $gte: fromDate, $lte: toDate } },
    ),
    loadAllByIdCursor<any>(
      (filter, limit) =>
        CycleCharge.find(filter)
          .sort({ chargeDate: 1, _id: 1 })
          .limit(limit)
          .lean<any[]>(),
      { ...orgFamilyFilter, chargeDate: { $gte: fromDate, $lte: toDate } },
    ),
  ])

  // Net refunds out of income to stay consistent with `calculateFamilyBalance`.
  // Using gross `amount` here caused the statement's closing balance to drift
  // from the family's real balance whenever a payment in this window had been
  // partially or fully refunded.
  const priorRefundTotal = priorPeriodRefunds.reduce(
    (sum, p) => sum + Math.max(0, Number(p.refundedAmount || 0)),
    0,
  )
  const totalIncome =
    payments.reduce((sum, p) => sum + (Number(p.netAmount) || 0), 0) - priorRefundTotal
  const totalWithdrawals = withdrawals.reduce((sum, w) => {
    const amt = Number(w.amount || 0)
    return Number.isFinite(amt) && amt >= 0 ? sum + amt : sum
  }, 0)
  const totalExpenses = lifecycleEvents.reduce((sum, e) => sum + (e.amount || 0), 0)
  const totalCycleCharges = cycleCharges.reduce((sum, c) => sum + (c.amount || 0), 0)

  // Derive closing from the same balance helper used everywhere else so
  // refunds on pre-period payments (refundedAt inside this window) are
  // reflected even though their paymentDate falls before fromDate.
  const { balance: closingBalance } = await calculateFamilyBalance(
    familyId,
    organizationId,
    toDate,
  )

  return {
    payments,
    priorPeriodRefunds,
    withdrawals,
    lifecycleEvents,
    cycleCharges,
    totalIncome,
    totalWithdrawals,
    totalExpenses,
    totalCycleCharges,
    closingBalance,
  }
}

/**
 * Build a single date-sorted transaction list from the four ledgers,
 * shaped for the StatementTransaction renderer (used by the PDF and
 * the statement-detail GET). Withdrawals, lifecycle events, and cycle
 * charges are emitted with negative `amount` so the PDF column lines
 * up with the closing-balance formula above.
 */
export function buildTransactionList(
  period: StatementPeriodAggregates,
): {
  type: 'payment' | 'withdrawal' | 'event' | 'cycle-charge'
  date: Date
  description: string
  amount: number
  notes: string
}[] {
  return [
    ...period.payments.map((p) => {
      const gross = Number(p.amount || 0)
      const refunded = Number(p.refundedAmount || 0)
      const net = Math.max(0, gross - refunded)
      // Annotate refunded payments inline so the customer sees why the
      // amount column doesn't match what they originally paid.
      const description =
        refunded > 0
          ? `Payment - ${p.type || 'membership'} (refunded)`
          : `Payment - ${p.type || 'membership'}`
      return {
        type: 'payment' as const,
        date: p.paymentDate,
        description,
        amount: net,
        notes: sanitizePaymentNotes(p.notes),
      }
    }),
    ...(period.priorPeriodRefunds || []).map((p) => ({
      type: 'payment' as const,
      date: p.refundedAt,
      description: `Refund — ${p.type || 'membership'}`,
      amount: -Math.max(0, Number(p.refundedAmount || 0)),
      notes: sanitizePaymentNotes(p.notes),
    })),
    ...period.withdrawals.map((w) => ({
      type: 'withdrawal' as const,
      date: w.withdrawalDate,
      description: `Withdrawal - ${w.reason || ''}`.trim().replace(/-\s*$/, '').trim(),
      amount: -w.amount,
      notes: '',
    })),
    ...period.lifecycleEvents.map((e) => ({
      type: 'event' as const,
      date: e.eventDate,
      description: `${e.eventType} (${Number(e.amount || 0).toFixed(2)})${e.notes ? ` — ${e.notes}` : ''}`.trim(),
      amount: 0,
      notes: e.notes || '',
    })),
    ...period.cycleCharges.map((c) => ({
      type: 'cycle-charge' as const,
      date: c.chargeDate,
      description: c.planName
        ? `Annual dues — ${c.planName} (cycle ${c.cycleYear})`
        : `Annual dues — cycle ${c.cycleYear}`,
      amount: -c.amount,
      notes: c.notes || '',
    })),
  ].sort((a, b) => {
    const ta = new Date(a.date).getTime()
    const tb = new Date(b.date).getTime()
    if (!Number.isFinite(ta) && !Number.isFinite(tb)) return 0
    if (!Number.isFinite(ta)) return 1
    if (!Number.isFinite(tb)) return -1
    return ta - tb
  })
}

/** Persisted Statement fields derived from a loaded period. */
export function statementSnapshotFromPeriod(
  openingBalance: number,
  period: StatementPeriodAggregates,
) {
  return {
    openingBalance,
    income: period.totalIncome,
    withdrawals: period.totalWithdrawals,
    expenses: period.totalExpenses,
    cycleCharges: period.totalCycleCharges,
    closingBalance: period.closingBalance,
  }
}
