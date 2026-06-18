'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowPathIcon, InformationCircleIcon } from '@heroicons/react/24/outline'
import { Button, Card, PageHeader, Tooltip } from '@/app/components/ui'
import { useCurrency } from '@/lib/client/useCurrency'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useToast } from '@/app/components/Toast'
import { useT } from '@/lib/client/i18n'

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
  const t = useT()
  const { format: formatMoney } = useCurrency()
  const currentYear = new Date().getFullYear()
  const [recommendation, setRecommendation] = useState<DuesRecommendation | null>(
    initialRecommendation,
  )
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
            toast.error(t('projections.error.load'))
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
    [toast, t],
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

  useOrgChanged(
    useCallback(() => {
      setRecommendation(null)
      setHasError(false)
      runRefetch(windowYears, horizon, startYear)
    }, [runRefetch, windowYears, horizon, startYear]),
  )

  const r = recommendation
  const showBM = r?.chargesBarMitzvahPayers ?? false
  const yearLabel =
    r && r.historyYearsSeen === 1 ? t('projections.yearSingular') : t('projections.yearPlural')

  return (
    <div className="min-h-screen p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <PageHeader
          title={t('projections.title')}
          subtitle={t('projections.subtitle').replace('{horizon}', String(horizon))}
        />

        {!r && !hasError && (
          <Card>
            <p className="text-sm text-fg-muted">{t('projections.loading')}</p>
          </Card>
        )}

        {hasError && (
          <Card className="border-l-4 border-danger">
            <p className="text-sm text-fg">{t('projections.error.title')}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2 px-0"
              onClick={() => refetch(windowYears, horizon, startYear)}
            >
              {t('projections.error.retry')}
            </Button>
          </Card>
        )}

        {r && (
          <>
            <Card
              compact
              className="space-y-3 sm:space-y-0 sm:flex sm:flex-wrap sm:items-end sm:gap-6"
            >
              <ControlGroup label={t('projections.control.historyWindow')}>
                <div className="flex flex-wrap gap-1">
                  {WINDOW_OPTIONS.map((opt) => (
                    <Chip
                      key={opt}
                      selected={windowYears === opt}
                      onClick={() => setWindowYears(opt)}
                    >
                      {opt} {t('projections.control.yearSuffix')}
                    </Chip>
                  ))}
                </div>
              </ControlGroup>

              <ControlGroup label={t('projections.control.forecastHorizon')}>
                <div className="flex flex-wrap gap-1">
                  {HORIZON_OPTIONS.map((opt) => (
                    <Chip key={opt} selected={horizon === opt} onClick={() => setHorizon(opt)}>
                      {opt} {t('projections.control.yearSuffix')}
                    </Chip>
                  ))}
                </div>
              </ControlGroup>

              <ControlGroup label={t('projections.control.startYear')}>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setStartYear((y) => Math.max(currentYear - 5, y - 1))}
                    className="text-xs px-2 py-1 rounded border border-border text-fg hover:bg-surface focus-ring"
                    aria-label={t('projections.control.earlierYear')}
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
                    aria-label={t('projections.control.laterYear')}
                  >
                    +
                  </button>
                  {startYear !== currentYear && (
                    <button
                      type="button"
                      onClick={() => setStartYear(currentYear)}
                      className="text-xs text-accent hover:underline focus-ring rounded"
                    >
                      {t('projections.control.reset')}
                    </button>
                  )}
                </div>
              </ControlGroup>

              <div className="sm:ml-auto flex items-center gap-3">
                {loading && (
                  <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
                    <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />{' '}
                    {t('projections.control.updating')}
                  </span>
                )}
                <span className="text-xs text-fg-muted text-right">
                  {t('projections.control.historySummary')
                    .replace('{years}', String(r.historyYearsSeen))
                    .replace('{yearLabel}', yearLabel)}
                  <br />
                  {t('projections.control.newFamilies').replace(
                    '{count}',
                    r.avgNewFamiliesPerYear.toFixed(1),
                  )}
                  {showBM && (
                    <>
                      ,{' '}
                      {t('projections.control.newBmPayers').replace(
                        '{count}',
                        r.avgNewBarMitzvahsPerYear.toFixed(1),
                      )}
                    </>
                  )}
                  .
                </span>
              </div>
            </Card>

            <Card
              noPadding
              aria-label={t('projections.table.ariaLabel').replace('{horizon}', String(horizon))}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-app-subtle border-b-2 border-border text-fg-muted text-xs uppercase tracking-wide">
                      <th className="text-left px-3 py-2 sticky left-0 bg-app-subtle z-10">
                        {t('projections.table.year')}
                      </th>
                      <th className="text-right px-3 py-2">{t('projections.table.families')}</th>
                      {showBM && (
                        <th className="text-right px-3 py-2">{t('projections.table.bmPayers')}</th>
                      )}
                      <th className="text-right px-3 py-2">{t('projections.table.totalPayers')}</th>
                      <th className="text-right px-3 py-2">
                        {t('projections.table.expectedExpenses')}
                      </th>
                      <th className="text-right px-3 py-2 bg-accent/5">
                        <span className="inline-flex items-center justify-end gap-1">
                          {t('projections.table.recommendedDues')}
                          <Tooltip content={t('projections.table.duesTooltip')}>
                            <button
                              type="button"
                              className="text-fg-subtle hover:text-fg-muted focus-ring rounded normal-case"
                              aria-label={t('projections.table.duesAria')}
                            >
                              <InformationCircleIcon className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </Tooltip>
                        </span>
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
                                {t('projections.table.thisYear')}
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
            </Card>

            <details>
              <Card
                compact
                className="overflow-hidden p-0"
                aria-label={t('projections.howCalculated')}
              >
                <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-fg focus-ring">
                  {t('projections.howCalculated')}
                </summary>
                <div className="border-t border-border p-4 sm:p-6 space-y-4">
                  <p className="text-xs text-fg-muted">
                    {t('projections.how.formulasIn')}{' '}
                    <code className="rounded bg-app-subtle px-1 py-0.5 text-xs text-fg">
                      lib/projections.ts
                    </code>
                    .
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2 text-xs text-fg-muted">
                      <p className="text-fg">
                        <span className="font-medium">{t('projections.how.recommendedDues')}</span>{' '}
                        ={' '}
                        <span className="tabular">
                          {t('projections.how.recommendedDuesFormula')}
                        </span>
                      </p>
                      <p>
                        <span className="font-medium text-fg">
                          {t('projections.how.expectedExpenses')}
                        </span>{' '}
                        {formatMoney(r.expectedAnnualEventExpense)}{' '}
                        {t('projections.how.expectedExpensesDesc')}
                      </p>
                      <p>
                        <span className="font-medium text-fg">
                          {t('projections.how.totalPayers')}
                        </span>{' '}
                        ={' '}
                        {t('projections.how.currentFamilies').replace(
                          '{count}',
                          String(r.currentFamilies),
                        )}
                        {showBM && (
                          <>
                            {' '}
                            +{' '}
                            {t('projections.how.currentBmPayers').replace(
                              '{count}',
                              String(r.currentBarMitzvahPayers),
                            )}
                          </>
                        )}
                        , {t('projections.how.growthNote')}{' '}
                        {t('projections.how.newFamiliesGrowth').replace(
                          '{count}',
                          r.avgNewFamiliesPerYear.toFixed(1),
                        )}
                        {showBM && (
                          <>
                            {' '}
                            {t('projections.how.newBmGrowth').replace(
                              '{count}',
                              r.avgNewBarMitzvahsPerYear.toFixed(1),
                            )}
                          </>
                        )}
                        .
                      </p>
                      {!showBM && (
                        <p className="pt-1 border-t border-border">
                          {t('projections.how.noBmNote')}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-xs font-semibold text-fg uppercase tracking-wide">
                        {t('projections.how.eventExpenses')}
                      </h3>
                      {r.perEvent.length === 0 ? (
                        <p className="text-xs text-fg-muted">
                          {t('projections.how.noEvents')}{' '}
                          <a
                            href="/settings?tab=eventTypes"
                            className="text-accent hover:underline"
                          >
                            {t('projections.how.settingsLink')}
                          </a>
                          .
                        </p>
                      ) : (
                        <table className="w-full text-xs">
                          <thead className="text-fg-muted">
                            <tr>
                              <th className="text-left py-1">{t('projections.how.eventColumn')}</th>
                              <th className="text-right py-1">{t('projections.how.avgPerYear')}</th>
                              <th className="text-right py-1">{t('projections.how.cost')}</th>
                              <th className="text-right py-1">{t('projections.how.total')}</th>
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
                                {t('projections.how.total')}
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
                </div>
              </Card>
            </details>
          </>
        )}
      </div>
    </div>
  )
}

function ControlGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wide text-fg-muted font-medium">{label}</div>
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
  if (Math.abs(n - Math.round(n)) < 1e-6) return String(Math.round(n))
  return n.toFixed(1)
}
