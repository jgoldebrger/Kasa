'use client'

import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { CalculatorIcon, InformationCircleIcon, ExclamationTriangleIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import { useCurrency } from '@/lib/client/useCurrency'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useRequestGeneration } from '@/lib/client/useRequestGeneration'
import {
  Button,
  DataView,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Select,
  SkeletonRows,
  Tooltip,
} from '@/app/components/ui'

interface PlanBreakdown {
  planId?: string
  planNumber?: number
  name: string
  count: number
  familyCount?: number
  income: number
}

interface EventBreakdown {
  type: string
  name: string
  count: number
  amount: number
}

// Per-year cached snapshot, as returned by /api/calculations and as
// prefetched by the server component. Fields can be absent on pre-
// refactor snapshots — the consumers below default everything to a safe
// zero/empty value so the UI still renders. Recompute the year to fill
// the row with real numbers.
interface YearlyCalculation {
  _id: string
  year: number
  byPlan?: PlanBreakdown[]
  byEvent?: EventBreakdown[]
  totalPayments?: number
  planIncome?: number
  totalIncome?: number
  totalExpenses?: number
  extraDonation?: number
  extraExpense?: number
  calculatedIncome?: number
  calculatedExpenses?: number
  balance?: number
}

interface NormalizedCalculation {
  _id: string
  year: number
  byPlan: PlanBreakdown[]
  byEvent: EventBreakdown[]
  planIncome: number
  totalPayments: number
  totalIncome: number
  totalExpenses: number
  extraDonation: number
  extraExpense: number
  calculatedIncome: number
  calculatedExpenses: number
  balance: number
}

/**
 * Coerce a raw snapshot into a strictly-typed shape: all aggregates
 * defaulted to 0, all arrays defaulted to []. No legacy field handling —
 * a pre-refactor snapshot simply renders as zeros until the user
 * recomputes it.
 */
function toNormalized(raw: YearlyCalculation): NormalizedCalculation {
  return {
    _id: raw._id,
    year: raw.year,
    byPlan: Array.isArray(raw.byPlan) ? raw.byPlan : [],
    byEvent: Array.isArray(raw.byEvent) ? raw.byEvent : [],
    planIncome: raw.planIncome ?? 0,
    totalPayments: raw.totalPayments ?? 0,
    totalIncome: raw.totalIncome ?? 0,
    totalExpenses: raw.totalExpenses ?? 0,
    extraDonation: raw.extraDonation ?? 0,
    extraExpense: raw.extraExpense ?? 0,
    calculatedIncome: raw.calculatedIncome ?? 0,
    calculatedExpenses: raw.calculatedExpenses ?? 0,
    balance: raw.balance ?? 0,
  }
}

export interface CalculationsViewProps {
  initialCalculations?: YearlyCalculation[]
}

export default function CalculationsView({
  initialCalculations,
}: CalculationsViewProps = {}) {
  const { format: formatMoney } = useCurrency()
  const sortedInitial = Array.isArray(initialCalculations)
    ? [...initialCalculations].sort((a, b) => b.year - a.year)
    : []
  const serverHydrated = initialCalculations !== undefined
  const hasFetchedRef = useRef(serverHydrated)
  const { begin, invalidate, isStale } = useRequestGeneration()
  const [calculations, setCalculations] = useState<YearlyCalculation[]>(sortedInitial)
  const [showModal, setShowModal] = useState(false)
  // `null` means "All Years Summary"; only meaningful when calculations exist.
  const [selectedYear, setSelectedYear] = useState<number | null>(
    sortedInitial.length > 0 ? sortedInitial[0].year : null,
  )
  const [formData, setFormData] = useState({
    year: new Date().getFullYear(),
    extraDonation: 0,
    extraExpense: 0,
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!serverHydrated)
  const [loadError, setLoadError] = useState(false)

  const fetchCalculations = useCallback(async () => {
    const gen = begin()
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch('/api/calculations')
      if (isStale(gen)) return
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (isStale(gen)) return
      if (Array.isArray(data)) {
        const sorted = [...data].sort((a: YearlyCalculation, b: YearlyCalculation) => b.year - a.year)
        setCalculations(sorted)
        if (sorted.length > 0) setSelectedYear(sorted[0].year)
      }
    } catch {
      if (isStale(gen)) return
      setLoadError(true)
      setCalculations([])
    } finally {
      if (!isStale(gen)) setLoading(false)
    }
  }, [begin, isStale])

  useEffect(() => {
    if (hasFetchedRef.current) return
    hasFetchedRef.current = true
    fetchCalculations()
  }, [fetchCalculations])

  useOrgChanged(useCallback(() => {
    invalidate()
    hasFetchedRef.current = false
    setCalculations([])
    setSelectedYear(null)
    setLoadError(false)
    fetchCalculations()
  }, [fetchCalculations, invalidate]))

  // Merge a freshly-computed snapshot into the local list (upsert by year)
  // so we avoid an extra round-trip to GET /api/calculations after POST.
  const upsertCalculation = (next: YearlyCalculation) => {
    setCalculations((prev) => {
      const without = prev.filter((c) => c.year !== next.year)
      return [next, ...without].sort((a, b) => b.year - a.year)
    })
  }

  const openModal = () => {
    setFormData({ year: new Date().getFullYear(), extraDonation: 0, extraExpense: 0 })
    setSubmitError(null)
    setShowModal(true)
  }

  const closeModal = () => {
    if (submitting) return
    setShowModal(false)
    setSubmitError(null)
  }

  const handleCalculate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    const yearNum = Number(formData.year)
    const donation = Number(formData.extraDonation)
    const expense = Number(formData.extraExpense)
    if (!Number.isFinite(yearNum) || yearNum < 1900 || yearNum > 2200) {
      setSubmitError('Enter a valid year (1900–2200)')
      return
    }
    if (!Number.isFinite(donation) || donation < 0 || !Number.isFinite(expense) || expense < 0) {
      setSubmitError('Enter valid non-negative adjustment amounts')
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch('/api/calculations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      if (!res.ok) {
        let message = `Failed to calculate (HTTP ${res.status})`
        try {
          const body = await res.json().catch(() => ({}))
          if (body?.error) message = String(body.error)
        } catch {
          // non-JSON error body — keep the generic message.
        }
        setSubmitError(message)
        return
      }
      const created = (await res.json().catch(() => null)) as YearlyCalculation | null
      if (!created) {
        setSubmitError('Unexpected response from server')
        return
      }
      upsertCalculation(created)
      setSelectedYear(formData.year)
      setShowModal(false)
    } catch (error) {
      console.error('Error calculating:', error)
      setSubmitError(error instanceof Error ? error.message : 'Network error')
    } finally {
      setSubmitting(false)
    }
  }

  // Coerce every row once so the table cells and the detail panel share
  // the same numbers (and so missing-aggregate snapshots render as zero).
  const normalized = useMemo(() => calculations.map(toNormalized), [calculations])
  const detail = useMemo(
    () => (selectedYear == null ? null : normalized.find((c) => c.year === selectedYear) ?? null),
    [normalized, selectedYear],
  )
  const summary = useMemo(() => {
    if (normalized.length === 0) return null
    return normalized.reduce(
      (acc, c) => ({
        calculatedIncome: acc.calculatedIncome + c.calculatedIncome,
        calculatedExpenses: acc.calculatedExpenses + c.calculatedExpenses,
        balance: acc.balance + c.balance,
      }),
      { calculatedIncome: 0, calculatedExpenses: 0, balance: 0 },
    )
  }, [normalized])

  return (
    <main className="min-h-screen bg-app-subtle px-4 py-6 sm:px-6 md:px-8">
      <div className="mx-auto max-w-7xl">
        <PageHeader
          title="Yearly Calculations"
          subtitle="Actual payments received, lifecycle expenses, and net balance for each year."
          actions={
            <Button onClick={openModal} leftIcon={<CalculatorIcon className="h-5 w-5" />}>
              Calculate Year
            </Button>
          }
        />

        <details className="mb-6 surface-card border border-border rounded-lg">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-fg focus-ring rounded-lg">
            How is this calculated?
          </summary>
          <div className="border-t border-border px-4 py-4 text-sm text-fg-muted space-y-3">
            <p>
              Yearly snapshots use the formulas in{' '}
              <code className="rounded bg-app-subtle px-1 py-0.5 text-xs text-fg">lib/calculations.ts</code>.
              Headline numbers reflect <span className="font-medium text-fg">actual cash</span>, not expected plan dues.
            </p>
            <dl className="space-y-2 text-xs">
              <div>
                <dt className="font-medium text-fg">Payments received</dt>
                <dd>Sum of net payments recorded for the year (payment year or payment date), refunds included.</dd>
              </div>
              <div>
                <dt className="font-medium text-fg">Total received (calculated income)</dt>
                <dd>
                  <span className="tabular">totalPayments + extraDonation</span>
                </dd>
              </div>
              <div>
                <dt className="font-medium text-fg">Calculated expenses</dt>
                <dd>
                  Lifecycle event payments for the year plus any manual extra expense (
                  <span className="tabular">totalExpenses + extraExpense</span>).
                </dd>
              </div>
              <div>
                <dt className="font-medium text-fg">Net balance</dt>
                <dd>
                  <span className="tabular">calculatedIncome − calculatedExpenses</span>
                </dd>
              </div>
              <div>
                <dt className="font-medium text-fg">Expected plan dues (reference)</dt>
                <dd>
                  Current roster × each plan&apos;s yearly price — not a historical snapshot. Compare against payments
                  received; do not treat as billed revenue for past years.
                </dd>
              </div>
            </dl>
          </div>
        </details>

        {loading ? (
          <div className="surface-card p-6">
            <SkeletonRows count={6} />
          </div>
        ) : loadError ? (
          <EmptyState
            icon={<ExclamationTriangleIcon />}
            title="Couldn't load calculations"
            description="Check your connection and try again."
            cta={{
              label: 'Retry',
              onClick: () => fetchCalculations(),
              icon: <ArrowPathIcon className="h-4 w-4" />,
            }}
          />
        ) : normalized.length === 0 ? (
          <EmptyState
            icon={<CalculatorIcon />}
            title="No calculations yet"
            description="Refresh a year's totals from the latest payments, lifecycle events, and plan roster."
            cta={{
              label: 'Calculate a year',
              onClick: openModal,
              icon: <CalculatorIcon className="h-5 w-5" />,
            }}
          />
        ) : (
          <div className="surface-card mb-6 p-6">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-4">
              <Select
                label="Select Year"
                value={selectedYear ?? ''}
                onChange={(e) =>
                  setSelectedYear(e.target.value ? parseInt(e.target.value, 10) : null)
                }
                wrapperClassName="sm:w-64"
              >
                <option value="">View All Years Summary</option>
                {normalized.map((calc) => (
                  <option key={calc._id} value={calc.year}>
                    {calc.year}
                  </option>
                ))}
              </Select>
            </div>

            <DataView
              tableId="calculations"
              rows={normalized}
              globalSearch={{ placeholder: 'Search year…' }}
              pageSize={10}
              columns={[
                {
                  id: 'year',
                  header: 'Year',
                  headerText: 'Year',
                  cell: (c) => (
                    <span
                      className={`tabular font-medium ${
                        selectedYear === c.year ? 'text-accent' : 'text-fg'
                      }`}
                    >
                      {c.year}
                    </span>
                  ),
                  exportValue: (c) => c.year,
                  filter: { type: 'select', getValue: (c) => String(c.year) },
                },
                {
                  id: 'payments',
                  header: 'Payments Received',
                  headerText: 'Payments Received',
                  align: 'right',
                  cell: (c) => (
                    <span className="tabular text-green-700 dark:text-green-400">
                      {formatMoney(c.totalPayments)}
                    </span>
                  ),
                  exportValue: (c) => c.totalPayments,
                  filter: { type: 'numberRange', getValue: (c) => c.totalPayments },
                },
                {
                  id: 'income',
                  header: 'Total In',
                  headerText: 'Total In',
                  align: 'right',
                  cell: (c) => (
                    <span className="tabular text-green-700 dark:text-green-400">
                      {formatMoney(c.calculatedIncome)}
                    </span>
                  ),
                  exportValue: (c) => c.calculatedIncome,
                  filter: { type: 'numberRange', getValue: (c) => c.calculatedIncome },
                },
                {
                  id: 'expenses',
                  header: 'Expenses',
                  headerText: 'Expenses',
                  align: 'right',
                  cell: (c) => (
                    <span className="tabular text-red-700 dark:text-red-400">
                      {formatMoney(c.calculatedExpenses)}
                    </span>
                  ),
                  exportValue: (c) => c.calculatedExpenses,
                  filter: { type: 'numberRange', getValue: (c) => c.calculatedExpenses },
                },
                {
                  id: 'balance',
                  header: 'Balance',
                  headerText: 'Balance',
                  align: 'right',
                  cell: (c) => (
                    <span
                      className={`tabular font-bold ${
                        c.balance >= 0
                          ? 'text-green-700 dark:text-green-400'
                          : 'text-red-700 dark:text-red-400'
                      }`}
                    >
                      {formatMoney(c.balance)}
                    </span>
                  ),
                  exportValue: (c) => c.balance,
                  filter: { type: 'numberRange', getValue: (c) => c.balance },
                },
                {
                  id: 'actions',
                  header: 'Actions',
                  headerText: 'Actions',
                  align: 'center',
                  cell: (c) => (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedYear(c.year)
                      }}
                      className="focus-ring rounded text-sm text-accent hover:text-accent-hover"
                    >
                      View Details
                    </button>
                  ),
                  exportValue: () => '',
                },
              ]}
              rowKey={(c) => c._id}
              onRowClick={(c) => setSelectedYear(c.year)}
              mobileCard={(c) => (
                <div
                  className={`surface-card p-4 ${
                    selectedYear === c.year ? 'ring-2 ring-accent' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="tabular font-semibold text-fg">Year {c.year}</div>
                    <span
                      className={`tabular font-bold ${
                        c.balance >= 0
                          ? 'text-green-700 dark:text-green-400'
                          : 'text-red-700 dark:text-red-400'
                      }`}
                    >
                      {formatMoney(c.balance)}
                    </span>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="text-fg-muted">Payments</dt>
                      <dd className="tabular text-green-700 dark:text-green-400">
                        {formatMoney(c.totalPayments)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Expenses</dt>
                      <dd className="tabular text-red-700 dark:text-red-400">
                        {formatMoney(c.calculatedExpenses)}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}
            />
          </div>
        )}

        {/* All-years summary panel — shown when no specific year is selected. */}
        {!detail && summary && (
          <div className="surface-card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-fg">All Years Summary</h2>
              <span className="text-sm text-fg-muted">
                {normalized.length} {normalized.length === 1 ? 'year' : 'years'}
              </span>
            </div>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-app-subtle p-4">
                <dt className="text-sm text-fg-muted">Total Payments Received</dt>
                <dd className="mt-1 tabular text-2xl font-semibold text-green-700 dark:text-green-400">
                  {formatMoney(
                    normalized.reduce((sum, c) => sum + c.totalPayments, 0),
                  )}
                </dd>
              </div>
              <div className="rounded-lg border border-border bg-app-subtle p-4">
                <dt className="text-sm text-fg-muted">Total Expenses</dt>
                <dd className="mt-1 tabular text-2xl font-semibold text-red-700 dark:text-red-400">
                  {formatMoney(summary.calculatedExpenses)}
                </dd>
              </div>
              <div className="rounded-lg border border-border bg-app-subtle p-4">
                <dt className="text-sm text-fg-muted">Net Balance</dt>
                <dd
                  className={`mt-1 tabular text-2xl font-semibold ${
                    summary.balance >= 0
                      ? 'text-green-700 dark:text-green-400'
                      : 'text-red-700 dark:text-red-400'
                  }`}
                >
                  {formatMoney(summary.balance)}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-xs italic text-fg-muted">
              Totals use actual payments recorded for each year. Click Calculate Year to refresh a
              snapshot after new payments or lifecycle events.
            </p>
          </div>
        )}

        {/* Detailed view — shown when a specific year is selected. */}
        {detail && (
          <div key={detail._id} className="surface-card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-fg">Year {detail.year}</h2>
              <button
                type="button"
                onClick={() => setSelectedYear(null)}
                className="focus-ring rounded text-sm text-fg-muted hover:text-fg"
              >
                Close Details
              </button>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {/* Cash received */}
              <div className="md:border-r md:border-border md:pr-6">
                <h3 className="mb-4 text-lg font-semibold text-green-700 dark:text-green-400">
                  Money In
                </h3>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="font-medium">Payments received ({detail.year}):</span>
                    <span className="tabular font-semibold text-green-700 dark:text-green-400">
                      {formatMoney(detail.totalPayments)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Extra donation (manual):</span>
                    <span className="tabular font-medium">
                      {formatMoney(detail.extraDonation)}
                    </span>
                  </div>
                  <div className="mt-2 flex justify-between border-t border-border pt-2">
                    <span className="font-bold">Total received:</span>
                    <span className="tabular font-bold text-green-700 dark:text-green-400">
                      {formatMoney(detail.calculatedIncome)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-fg-muted">
                    Based on payments recorded for {detail.year} (payment year or payment date).
                  </p>
                </div>

                <div className="mt-6 rounded-lg border border-border bg-app-subtle/60 p-4">
                  <div className="mb-2 flex items-center gap-1.5">
                    <h4 className="text-sm font-semibold text-fg-muted">
                      Expected plan dues (reference only)
                    </h4>
                    <Tooltip content="Based on today's roster — not a historical snapshot.">
                      <button
                        type="button"
                        className="text-fg-subtle hover:text-fg-muted focus-ring rounded"
                        aria-label="About expected plan dues"
                      >
                        <InformationCircleIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </Tooltip>
                  </div>
                  {detail.byPlan.length === 0 ? (
                    <p className="text-sm italic text-fg-muted">
                      No families are on a payment plan yet.
                    </p>
                  ) : (
                    <div className="space-y-2 text-sm">
                      {detail.byPlan.map((p) => (
                        <div
                          key={p.planId || `plan-${p.planNumber}-${p.name}`}
                          className="flex justify-between gap-2"
                        >
                          <span className="text-fg-muted">
                            {p.name}
                            {' '}
                            (
                            {typeof p.familyCount === 'number'
                              ? `${p.familyCount} ${p.familyCount === 1 ? 'family' : 'families'}`
                              : `${p.count} ${p.count === 1 ? 'member' : 'members'}`}
                            )
                          </span>
                          <span className="tabular font-medium text-fg">
                            {formatMoney(p.income || 0)}
                          </span>
                        </div>
                      ))}
                      <div className="flex justify-between border-t border-border pt-2">
                        <span>Expected total:</span>
                        <span className="tabular font-medium">{formatMoney(detail.planIncome)}</span>
                      </div>
                    </div>
                  )}
                  <p className="mt-2 text-xs italic text-fg-muted">
                    Uses today&apos;s family roster — not historical. Compare against payments
                    received above.
                  </p>
                </div>
              </div>

              {/* Expenses */}
              <div>
                <h3 className="mb-4 text-lg font-semibold text-red-700 dark:text-red-400">
                  Expenses
                </h3>
                <div className="space-y-2">
                  {detail.byEvent.length === 0 ? (
                    <div className="text-sm italic text-fg-muted">
                      No lifecycle event types configured for this year.
                    </div>
                  ) : (
                    detail.byEvent.map((ev) => (
                      <div key={ev.type} className="flex justify-between">
                        <span>
                          {ev.name} ({ev.count}):
                        </span>
                        <span className="tabular font-medium">
                          {formatMoney(ev.amount || 0)}
                        </span>
                      </div>
                    ))
                  )}
                  <div className="mt-2 flex justify-between border-t border-border pt-2">
                    <span>Total Expenses:</span>
                    <span className="tabular font-bold">
                      {formatMoney(detail.totalExpenses)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Extra Expense:</span>
                    <span className="tabular font-medium">
                      {formatMoney(detail.extraExpense)}
                    </span>
                  </div>
                  <div className="mt-2 flex justify-between border-t border-border pt-2">
                    <span className="font-bold">Calculated Expenses:</span>
                    <span className="tabular font-bold text-red-700 dark:text-red-400">
                      {formatMoney(detail.calculatedExpenses)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 border-t border-border pt-6">
              <div className="flex items-center justify-between">
                <span className="text-xl font-semibold">Net balance (received − expenses):</span>
                <span
                  className={`tabular text-2xl font-bold ${
                    detail.balance >= 0
                      ? 'text-green-700 dark:text-green-400'
                      : 'text-red-700 dark:text-red-400'
                  }`}
                >
                  {formatMoney(detail.balance)}
                </span>
              </div>
            </div>
          </div>
        )}

        <Modal
          open={showModal}
          onClose={closeModal}
          title="Calculate Year"
          description="Refresh payments received, expenses, and net balance for a given year."
          dismissible={!submitting}
          footer={
            <>
              <Button variant="secondary" onClick={closeModal} disabled={submitting}>
                Cancel
              </Button>
              <Button
                type="submit"
                form="calc-year-form"
                loading={submitting}
                disabled={submitting}
              >
                Calculate
              </Button>
            </>
          }
        >
          <form id="calc-year-form" onSubmit={handleCalculate} className="space-y-4">
            <Input
              label="Year"
              type="number"
              required
              min={1900}
              max={2999}
              value={formData.year}
              onChange={(e) =>
                setFormData({ ...formData, year: parseInt(e.target.value, 10) || formData.year })
              }
            />
            <Input
              label="Extra Donation"
              type="number"
              step="0.01"
              min={0}
              value={formData.extraDonation}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  extraDonation: parseFloat(e.target.value) || 0,
                })
              }
            />
            <Input
              label="Extra Expense"
              type="number"
              step="0.01"
              min={0}
              value={formData.extraExpense}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  extraExpense: parseFloat(e.target.value) || 0,
                })
              }
            />
            {submitError && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {submitError}
              </p>
            )}
          </form>
        </Modal>
      </div>
    </main>
  )
}
