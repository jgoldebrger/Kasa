'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import { PageHeader } from '@/app/components/ui'
import { useCurrency } from '@/lib/client/useCurrency'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useToast } from '@/app/components/Toast'

/**
 * 20-year dues-recommendation breakdown.
 *
 * Excel-style: rows are years, columns are the inputs and the answer.
 * Each year, the projected member base grows by the historical average of
 * new payers, and the recommended dues are recomputed against that base.
 * Event expenses are held flat (no inflation in v1 — keeps the math honest
 * with the "average from history" framing the user asked for).
 */

interface PerEventRow {
  eventTypeId: string
  name: string
  type: string
  historicalAvgCount: number
  historicalSampleSize: number
  currentCost: number
  expectedExpense: number
}

interface YearlyDuesRow {
  year: number
  projectedFamilies: number
  projectedBarMitzvahPayers: number
  projectedPayers: number
  expectedEventExpense: number
  recommendedDuesPerPayer: number
}

interface DuesRecommendation {
  recommendedDuesPerPayer: number
  expectedAnnualEventExpense: number
  currentPayers: number
  currentFamilies: number
  currentBarMitzvahPayers: number
  avgNewFamiliesPerYear: number
  avgNewBarMitzvahsPerYear: number
  projectedNewPayersPerYear: number
  projectedPayers: number
  chargesBarMitzvahPayers: boolean
  historyWindowYears: number
  historyYearsSeen: number
  perEvent: PerEventRow[]
  multiYear: YearlyDuesRow[]
}

interface Props {
  initialRecommendation: DuesRecommendation | null
  initialWindowYears: number
}

const WINDOW_OPTIONS = [3, 5, 10] as const
const HORIZON_OPTIONS = [5, 10, 20, 30, 50] as const
const DEFAULT_HORIZON = 20

export default function ProjectionsView({ initialRecommendation, initialWindowYears }: Props) {
  const toast = useToast()
  const { format: formatMoney } = useCurrency()
  const currentYear = new Date().getFullYear()
  const [recommendation, setRecommendation] = useState<DuesRecommendation | null>(initialRecommendation)
  const [windowYears, setWindowYears] = useState<number>(initialWindowYears)
  const [horizon, setHorizon] = useState<number>(
    initialRecommendation?.multiYear.length ?? DEFAULT_HORIZON,
  )
  const [startYear, setStartYear] = useState<number>(
    initialRecommendation?.multiYear[0]?.year ?? currentYear,
  )
  const [loading, setLoading] = useState(false)
  const [hasError, setHasError] = useState(false)
  const mountedRef = useRef(true)
  const requestGenRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Tracks the (window, horizon, startYear) triple the recommendation was
  // last fetched with. Lets the refetch effect compare against the server's
  // initial values so we don't double-fetch on mount.
  const initialKey = `${initialWindowYears}|${
    initialRecommendation?.multiYear.length ?? DEFAULT_HORIZON
  }|${initialRecommendation?.multiYear[0]?.year ?? currentYear}`

  const refetch = useCallback(
    async (years: number, h: number, sy: number, cancelled?: () => boolean) => {
      setLoading(true)
      setHasError(false)
      try {
        const res = await fetch(
          `/api/dues-recommendation?windowYears=${years}&forecastYears=${h}&startYear=${sy}`,
          { cache: 'no-store' },
        )
        if (cancelled?.()) return
        if (!res.ok) {
          if (!cancelled?.()) {
            setHasError(true)
            toast.error('Could not load dues recommendation.')
          }
          return
        }
        const data = (await res.json().catch(() => null)) as DuesRecommendation | null
        if (cancelled?.()) return
        if (!data) {
          setHasError(true)
          return
        }
        if (mountedRef.current) setRecommendation(data)
      } catch {
        if (!cancelled?.() && mountedRef.current) setHasError(true)
      } finally {
        if (!cancelled?.() && mountedRef.current) setLoading(false)
      }
    },
    [toast],
  )

  const runRefetch = useCallback(
    (years: number, h: number, sy: number) => {
      const gen = ++requestGenRef.current
      void refetch(years, h, sy, () => requestGenRef.current !== gen)
    },
    [refetch],
  )

  useEffect(() => {
    const key = `${windowYears}|${horizon}|${startYear}`
    if (key === initialKey && initialRecommendation) return
    runRefetch(windowYears, horizon, startYear)
    return () => {
      requestGenRef.current += 1
    }
  }, [windowYears, horizon, startYear, initialKey, initialRecommendation, runRefetch])

  useOrgChanged(useCallback(() => {
    setRecommendation(null)
    setHasError(false)
    runRefetch(windowYears, horizon, startYear)
  }, [runRefetch, windowYears, horizon, startYear]))

  const r = recommendation
  const showBM = r?.chargesBarMitzvahPayers ?? false

  return (
    <div className="min-h-screen p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <PageHeader
          title="Dues calculator"
          subtitle={`${horizon}-year break-even projection. Each year shows how many payers you'll have and what each must pay to cover expected event expenses.`}
        />

        {!r && !hasError && (
          <div className="surface-card p-6 text-sm text-fg-muted">Loading projection…</div>
        )}

        {hasError && (
          <div className="surface-card p-6 border-l-4 border-red-500">
            <p className="text-sm text-fg">Failed to load the projection.</p>
            <button
              type="button"
              onClick={() => refetch(windowYears, horizon, startYear)}
              className="text-xs text-accent hover:underline mt-2"
            >
              Try again
            </button>
          </div>
        )}

        {r && (
          <>
            {/* Controls bar — three knobs grouped left, loading + summary on the right */}
            <div className="surface-card p-3 sm:p-4 space-y-3 sm:space-y-0 sm:flex sm:flex-wrap sm:items-end sm:gap-6">
              <ControlGroup label="History window">
                <div className="flex flex-wrap gap-1">
                  {WINDOW_OPTIONS.map((opt) => (
                    <Chip
                      key={opt}
                      selected={windowYears === opt}
                      onClick={() => setWindowYears(opt)}
                    >
                      {opt} yr
                    </Chip>
                  ))}
                </div>
              </ControlGroup>

              <ControlGroup label="Forecast horizon">
                <div className="flex flex-wrap gap-1">
                  {HORIZON_OPTIONS.map((opt) => (
                    <Chip
                      key={opt}
                      selected={horizon === opt}
                      onClick={() => setHorizon(opt)}
                    >
                      {opt} yr
                    </Chip>
                  ))}
                </div>
              </ControlGroup>

              <ControlGroup label="Start year">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setStartYear((y) => Math.max(currentYear - 5, y - 1))}
                    className="text-xs px-2 py-1 rounded border border-border text-fg hover:bg-surface focus-ring"
                    aria-label="Earlier start year"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    value={startYear}
                    min={currentYear - 5}
                    max={currentYear + 50}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      if (Number.isFinite(n)) {
                        setStartYear(
                          Math.max(currentYear - 5, Math.min(currentYear + 50, Math.floor(n))),
                        )
                      }
                    }}
                    className="focus-ring w-20 bg-surface border border-border rounded-md px-2 py-1 text-sm text-fg outline-none tabular text-center"
                  />
                  <button
                    type="button"
                    onClick={() => setStartYear((y) => Math.min(currentYear + 50, y + 1))}
                    className="text-xs px-2 py-1 rounded border border-border text-fg hover:bg-surface focus-ring"
                    aria-label="Later start year"
                  >
                    +
                  </button>
                  {startYear !== currentYear && (
                    <button
                      type="button"
                      onClick={() => setStartYear(currentYear)}
                      className="text-xs text-accent hover:underline focus-ring rounded"
                    >
                      reset
                    </button>
                  )}
                </div>
              </ControlGroup>

              <div className="sm:ml-auto flex items-center gap-3">
                {loading && (
                  <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
                    <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" /> updating…
                  </span>
                )}
                <span className="text-xs text-fg-muted text-right">
                  Based on {r.historyYearsSeen} year
                  {r.historyYearsSeen === 1 ? '' : 's'} of event history,
                  <br />
                  {r.avgNewFamiliesPerYear.toFixed(1)} new families/yr
                  {showBM && (
                    <>, {r.avgNewBarMitzvahsPerYear.toFixed(1)} new bar-mitzvah payers/yr</>
                  )}
                  .
                </span>
              </div>
            </div>

            {/* The main event: 20-row Excel-style table */}
            <section className="surface-card p-0 overflow-hidden" aria-label="20-year projection">
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-app-subtle border-b-2 border-border text-fg-muted text-xs uppercase tracking-wide">
                      <th className="text-left px-3 py-2 sticky left-0 bg-app-subtle z-10">
                        Year
                      </th>
                      <th className="text-right px-3 py-2">Families</th>
                      {showBM && <th className="text-right px-3 py-2">BM payers</th>}
                      <th className="text-right px-3 py-2">Total payers</th>
                      <th className="text-right px-3 py-2">Expected expenses</th>
                      <th className="text-right px-3 py-2 bg-accent/5">
                        Recommended dues / payer
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.multiYear.map((row, i) => {
                      const isCurrent = row.year === currentYear
                      const isFifth = (i + 1) % 5 === 0
                      return (
                        <tr
                          key={row.year}
                          className={`border-b border-border last:border-b-0 ${
                            isCurrent
                              ? 'bg-accent/5 font-medium'
                              : isFifth
                              ? 'bg-app-subtle/40'
                              : ''
                          }`}
                        >
                          <td className="text-left px-3 py-1.5 sticky left-0 bg-inherit tabular text-fg">
                            {row.year}
                            {isCurrent && (
                              <span className="ml-2 text-[10px] uppercase tracking-wide text-accent">
                                this year
                              </span>
                            )}
                          </td>
                          <td className="text-right px-3 py-1.5 tabular text-fg">
                            {fmt(row.projectedFamilies)}
                          </td>
                          {showBM && (
                            <td className="text-right px-3 py-1.5 tabular text-fg">
                              {fmt(row.projectedBarMitzvahPayers)}
                            </td>
                          )}
                          <td className="text-right px-3 py-1.5 tabular text-fg">
                            {fmt(row.projectedPayers)}
                          </td>
                          <td className="text-right px-3 py-1.5 tabular text-fg-muted">
                            {formatMoney(row.expectedEventExpense)}
                          </td>
                          <td
                            className={`text-right px-3 py-1.5 tabular bg-accent/5 ${
                              isCurrent ? 'font-bold text-fg' : 'font-semibold text-fg'
                            }`}
                          >
                            {row.projectedPayers > 0
                              ? formatMoney(row.recommendedDuesPerPayer)
                              : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* How this is calculated (formula + per-event breakdown, collapsed-ish) */}
            <section className="surface-card p-4 sm:p-6 space-y-4" aria-label="Calculation breakdown">
              <h2 className="text-sm font-semibold text-fg">How this is calculated</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2 text-xs text-fg-muted">
                  <p className="text-fg">
                    <span className="font-medium">Recommended dues</span> ={' '}
                    <span className="tabular">expected event expenses ÷ total payers that year</span>
                  </p>
                  <p>
                    <span className="font-medium text-fg">Expected event expenses</span> ={' '}
                    {formatMoney(r.expectedAnnualEventExpense)} — for each lifecycle event, the average
                    historical count per year times the event's current cost, summed. Constant
                    across all forecast years (no inflation).
                  </p>
                  <p>
                    <span className="font-medium text-fg">Total payers per year</span> = current
                    families ({r.currentFamilies})
                    {showBM && (
                      <> + current bar-mitzvah-aged payers ({r.currentBarMitzvahPayers})</>
                    )}
                    , growing each year by the historical average:{' '}
                    +{r.avgNewFamiliesPerYear.toFixed(1)} families
                    {showBM && <> and +{r.avgNewBarMitzvahsPerYear.toFixed(1)} BM payers</>}.
                  </p>
                  {!showBM && (
                    <p className="pt-1 border-t border-border">
                      Your organization doesn't auto-assign a plan to bar-mitzvah-aged males, so
                      only families count as payers. To enable that, configure "Bar Mitzvah
                      auto-assign plan" on the organization settings.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-fg uppercase tracking-wide">
                    Event expenses
                  </h3>
                  {r.perEvent.length === 0 ? (
                    <p className="text-xs text-fg-muted">
                      No lifecycle events configured. Add some on{' '}
                      <a href="/settings?tab=eventTypes" className="text-accent hover:underline">
                        Settings → Event Types
                      </a>
                      .
                    </p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead className="text-fg-muted">
                        <tr>
                          <th className="text-left py-1">Event</th>
                          <th className="text-right py-1">Avg/yr</th>
                          <th className="text-right py-1">Cost</th>
                          <th className="text-right py-1">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.perEvent.map((e) => (
                          <tr key={e.eventTypeId} className="border-t border-border">
                            <td className="py-1 text-fg">{e.name}</td>
                            <td className="py-1 text-right tabular text-fg">
                              {e.historicalAvgCount.toFixed(1)}
                            </td>
                            <td className="py-1 text-right tabular text-fg-muted">
                              {formatMoney(e.currentCost)}
                            </td>
                            <td className="py-1 text-right tabular font-medium text-fg">
                              {formatMoney(e.expectedExpense)}
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-border">
                          <td className="py-1 font-semibold text-fg" colSpan={3}>
                            Total
                          </td>
                          <td className="py-1 text-right tabular font-bold text-fg">
                            {formatMoney(r.expectedAnnualEventExpense)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function ControlGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wide text-fg-muted font-medium">
        {label}
      </div>
      {children}
    </div>
  )
}

function Chip({
  children,
  selected,
  onClick,
}: {
  children: React.ReactNode
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs px-3 py-1 rounded-full border focus-ring transition-colors ${
        selected
          ? 'bg-accent text-accent-fg border-accent'
          : 'border-border text-fg hover:bg-surface'
      }`}
    >
      {children}
    </button>
  )
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0'
  // Whole-number friendly for whole values, one decimal otherwise.
  if (Math.abs(n - Math.round(n)) < 1e-6) return String(Math.round(n))
  return n.toFixed(1)
}
