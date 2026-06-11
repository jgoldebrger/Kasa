'use client'

import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { CalculatorIcon } from '@heroicons/react/24/outline'
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
  const hasInitial = sortedInitial.length > 0
  const hasFetchedRef = useRef(hasInitial)
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

  const fetchCalculations = useCallback(async () => {
    const gen = begin()
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
      setCalculations([])
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
          subtitle="Income, expenses, and balance per organization year."
          actions={
            <Button onClick={openModal} leftIcon={<CalculatorIcon className="h-5 w-5" />}>
              Calculate Year
            </Button>
          }
        />

        {normalized.length === 0 ? (
          <EmptyState
            icon={<CalculatorIcon />}
            title="No calculations yet"
            description="Run a yearly calculation to see income, expenses, and balance for any year."
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
                  id: 'income',
                  header: 'Income',
                  headerText: 'Income',
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
                      <dt className="text-fg-muted">Income</dt>
                      <dd className="tabular text-green-700 dark:text-green-400">
                        {formatMoney(c.calculatedIncome)}
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
                <dt className="text-sm text-fg-muted">Total Income</dt>
                <dd className="mt-1 tabular text-2xl font-semibold text-green-700 dark:text-green-400">
                  {formatMoney(summary.calculatedIncome)}
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
              Summary aggregates the saved snapshot for each year. Recompute a year above to refresh
              its contribution.
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
              {/* Income */}
              <div className="md:border-r md:border-border md:pr-6">
                <h3 className="mb-4 text-lg font-semibold text-green-700 dark:text-green-400">
                  Income
                </h3>
                {detail.year !== new Date().getFullYear() && (
                  <p className="mb-3 rounded-md border border-amber-300/40 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-100">
                    Heads up: plan-income figures use the current family
                    roster, not a snapshot of {detail.year}. Payments shown
                    below are bounded to that year correctly.
                  </p>
                )}
                <div className="space-y-2">
                  {detail.byPlan.length === 0 ? (
                    <div className="text-sm italic text-fg-muted">
                      No payment plans configured for this year.
                    </div>
                  ) : (
                    detail.byPlan.map((p) => (
                      <div
                        key={p.planId || `plan-${p.planNumber}-${p.name}`}
                        className="flex justify-between"
                      >
                        <span>
                          {p.name}
                          {' '}
                          (
                          {typeof p.familyCount === 'number'
                            ? `${p.familyCount} ${p.familyCount === 1 ? 'family' : 'families'}, ${p.count} ${p.count === 1 ? 'member' : 'members'}`
                            : `${p.count} ${p.count === 1 ? 'member' : 'members'}`}
                          ):
                        </span>
                        <span className="tabular font-medium">
                          {formatMoney(p.income || 0)}
                        </span>
                      </div>
                    ))
                  )}
                  <div className="mt-2 flex justify-between border-t border-border pt-2">
                    <span>Plan Income:</span>
                    <span className="tabular font-medium">
                      {formatMoney(detail.planIncome)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm text-fg-muted">
                    <span>Payments (from year) - informational only:</span>
                    <span className="tabular font-medium">
                      {formatMoney(detail.totalPayments)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Extra Donation:</span>
                    <span className="tabular font-medium">
                      {formatMoney(detail.extraDonation)}
                    </span>
                  </div>
                  <div className="mt-2 flex justify-between border-t border-border pt-2">
                    <span className="font-bold">Calculated Income:</span>
                    <span className="tabular font-bold text-green-700 dark:text-green-400">
                      {formatMoney(detail.calculatedIncome)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs italic text-fg-muted">
                    Note: Payments fulfill plan commitments and are not additional income. Income =
                    Plan Income + Extra Donation.
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
                <span className="text-xl font-semibold">Balance (Income - Expenses):</span>
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
          description="Recompute income, expenses, and balance for a given year."
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
