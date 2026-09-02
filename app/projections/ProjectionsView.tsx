'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowPathIcon, InformationCircleIcon } from '@heroicons/react/24/outline'
import { Button, Card, DataView, PageHeader, Tooltip, type DataColumn } from '@/app/components/ui'
import { useCurrency } from '@/lib/client/useCurrency'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useToast } from '@/app/components/Toast'
import { useT } from '@/lib/client/i18n'
import ContextualHelpLink from '@/app/components/ContextualHelpLink'
import { applyDuesScenario, formatScenarioAdjustment } from '@/lib/projections/scenario'

interface PerEventRow {
  eventTypeId: string
  name: string
  type: string
  currentCost: number
  rosterMapped: boolean
  historicalAvgPerYear: number
  projectedCountStartYear: number
  projectedExpenseStartYear: number
  countSource: 'roster' | 'historical' | 'planned' | 'blended'
}

interface PlanRecommendation {
  planId: string
  planName: string
  currentPrice: number
  familyCount: number
}

interface YearlyPlanRecommendation extends PlanRecommendation {
  recommendedPrice: number
}

interface YearlyDuesRow {
  year: number
  projectedFamilies: number
  projectedBarMitzvahPayers: number
  projectedPayers: number
  projectedExpenses: number
  projectedPlanIncome: number
  openingFundBalance: number
  closingFundBalance: number
  fundSolvent: boolean
  scaleFactor: number
  planRecommendations: YearlyPlanRecommendation[]
}

interface DuesRecommendation {
  plans: PlanRecommendation[]
  currentPlanIncome: number
  openingFundBalance: number
  solvencyScaleFactor: number
  avgNewChildrenPerYear: number
  historyYearsWithData: number
  expenseSource: 'blended'
  currentPayers: number
  currentFamilies: number
  currentBarMitzvahPayers: number
  avgNewFamiliesPerYear: number
  avgNewBarMitzvahsPerYear: number
  projectedNewPayersPerYear: number
  projectedPayers: number
  chargesBarMitzvahPayers: boolean
  growthLookbackYears: number
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
  const [duesChangePct, setDuesChangePct] = useState(0)
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
    r && r.growthLookbackYears === 1 ? t('projections.yearSingular') : t('projections.yearPlural')
  const headlineRow =
    r?.multiYear.find((row) => row.year === currentYear) ?? r?.multiYear[0] ?? null
  const startYearExpenses = r?.perEvent.reduce((s, e) => s + e.projectedExpenseStartYear, 0) ?? 0
  const hasShortfall = r?.multiYear.some((row) => !row.fundSolvent) ?? false

  const scenario = useMemo(() => {
    if (!r || !headlineRow || headlineRow.projectedPlanIncome <= 0) return null
    return applyDuesScenario(
      {
        openingFundBalance: headlineRow.openingFundBalance,
        projectedExpenses: headlineRow.projectedExpenses,
        projectedPlanIncome: headlineRow.projectedPlanIncome,
        scaleFactor: headlineRow.scaleFactor,
        plans: headlineRow.planRecommendations,
      },
      duesChangePct,
    )
  }, [r, headlineRow, duesChangePct])

  const multiYearColumns = useMemo<DataColumn<YearlyDuesRow>[]>(() => {
    const cols: DataColumn<YearlyDuesRow>[] = [
      {
        id: 'year',
        header: t('projections.table.year'),
        headerText: t('projections.table.year'),
        cell: (row) => (
          <span className="tabular text-fg">
            {row.year}
            {row.year === currentYear && (
              <span className="ml-2 text-[10px] uppercase tracking-wide text-accent">
                {t('projections.table.thisYear')}
              </span>
            )}
          </span>
        ),
        exportValue: (row) => row.year,
      },
      {
        id: 'projectedFamilies',
        header: t('projections.table.families'),
        headerText: t('projections.table.families'),
        align: 'right',
        cell: (row) => <span className="tabular text-fg">{fmt(row.projectedFamilies)}</span>,
        exportValue: (row) => row.projectedFamilies,
      },
    ]
    if (showBM) {
      cols.push({
        id: 'projectedBarMitzvahPayers',
        header: t('projections.table.bmPayers'),
        headerText: t('projections.table.bmPayers'),
        align: 'right',
        cell: (row) => (
          <span className="tabular text-fg">{fmt(row.projectedBarMitzvahPayers)}</span>
        ),
        exportValue: (row) => row.projectedBarMitzvahPayers,
      })
    }
    cols.push(
      {
        id: 'projectedPayers',
        header: t('projections.table.totalPayers'),
        headerText: t('projections.table.totalPayers'),
        align: 'right',
        cell: (row) => <span className="tabular text-fg">{fmt(row.projectedPayers)}</span>,
        exportValue: (row) => row.projectedPayers,
      },
      {
        id: 'projectedExpenses',
        header: t('projections.table.projectedExpenses'),
        headerText: t('projections.table.projectedExpenses'),
        align: 'right',
        cell: (row) => (
          <span className="tabular text-fg-muted">{formatMoney(row.projectedExpenses)}</span>
        ),
        exportValue: (row) => row.projectedExpenses,
      },
      {
        id: 'projectedPlanIncome',
        header: t('projections.table.planIncome'),
        headerText: t('projections.table.planIncome'),
        align: 'right',
        cell: (row) => (
          <span className="tabular text-fg-muted">{formatMoney(row.projectedPlanIncome)}</span>
        ),
        exportValue: (row) => row.projectedPlanIncome,
      },
      {
        id: 'closingFundBalance',
        header: t('projections.table.closingFund'),
        headerText: t('projections.table.closingFund'),
        align: 'right',
        cell: (row) => (
          <span className={`tabular font-medium ${row.fundSolvent ? 'text-fg' : 'text-danger'}`}>
            {formatMoney(row.closingFundBalance)}
          </span>
        ),
        exportValue: (row) => row.closingFundBalance,
      },
      {
        id: 'scaleFactor',
        header: t('projections.table.adjustment'),
        headerText: t('projections.table.adjustment'),
        align: 'right',
        cell: (row) => (
          <span className="tabular font-semibold text-fg">
            {row.projectedPlanIncome > 0 ? formatAdjustment(row.scaleFactor) : '—'}
          </span>
        ),
        exportValue: (row) => row.scaleFactor,
      },
    )
    if ((r?.plans.length ?? 0) > 0) {
      cols.push({
        id: 'planRecommendations',
        header: t('projections.table.recommendedPlans'),
        headerText: t('projections.table.recommendedPlans'),
        align: 'right',
        cell: (row) => (
          <span className="tabular text-xs text-fg">
            {row.planRecommendations.map((p) => (
              <div key={p.planId}>
                {p.planName}: {formatMoney(p.recommendedPrice)}
              </div>
            ))}
          </span>
        ),
        exportValue: (row) =>
          row.planRecommendations.map((p) => `${p.planName}:${p.recommendedPrice}`).join('; '),
      })
    }
    return cols
  }, [currentYear, formatMoney, r?.plans.length, showBM, t])

  const perEventColumns = useMemo<DataColumn<PerEventRow>[]>(
    () => [
      {
        id: 'name',
        header: t('projections.how.eventColumn'),
        headerText: t('projections.how.eventColumn'),
        cell: (row) => <span className="text-fg">{row.name}</span>,
        exportValue: (row) => row.name,
      },
      {
        id: 'historicalAvgPerYear',
        header: t('projections.how.avgPerYear'),
        headerText: t('projections.how.avgPerYear'),
        align: 'right',
        cell: (row) => (
          <span className="tabular text-fg-muted">{row.historicalAvgPerYear.toFixed(1)}</span>
        ),
        exportValue: (row) => row.historicalAvgPerYear,
      },
      {
        id: 'projectedCountStartYear',
        header: t('projections.how.countInYear'),
        headerText: t('projections.how.countInYear'),
        align: 'right',
        cell: (row) => <span className="tabular text-fg">{row.projectedCountStartYear}</span>,
        exportValue: (row) => row.projectedCountStartYear,
      },
      {
        id: 'currentCost',
        header: t('projections.how.cost'),
        headerText: t('projections.how.cost'),
        align: 'right',
        cell: (row) => (
          <span className="tabular text-fg-muted">{formatMoney(row.currentCost)}</span>
        ),
        exportValue: (row) => row.currentCost,
      },
      {
        id: 'projectedExpenseStartYear',
        header: t('projections.how.total'),
        headerText: t('projections.how.total'),
        align: 'right',
        cell: (row) => (
          <span className="tabular font-medium text-fg">
            {formatMoney(row.projectedExpenseStartYear)}
          </span>
        ),
        exportValue: (row) => row.projectedExpenseStartYear,
      },
    ],
    [formatMoney, t],
  )

  return (
    <div className="min-h-screen p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <PageHeader
          title={t('projections.title')}
          subtitle={t('projections.subtitle').replace('{horizon}', String(horizon))}
          actions={<ContextualHelpLink slug="dues-calculator" />}
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
            <Card compact className="space-y-4">
              <h2 className="text-sm font-semibold text-fg">{t('projections.headline.title')}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-fg-muted">
                    {t('projections.headline.openingFund')}
                  </div>
                  <div className="tabular font-semibold text-fg">
                    {formatMoney(r.openingFundBalance)}
                  </div>
                </div>
                {headlineRow && (
                  <>
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-fg-muted">
                        {t('projections.headline.projectedCosts')}
                      </div>
                      <div className="tabular font-semibold text-fg">
                        {formatMoney(headlineRow.projectedExpenses)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-fg-muted">
                        {t('projections.headline.planIncome')}
                      </div>
                      <div className="tabular font-semibold text-fg">
                        {formatMoney(headlineRow.projectedPlanIncome)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-fg-muted">
                        {t('projections.headline.closingFund')}
                      </div>
                      <div
                        className={`tabular font-semibold ${
                          headlineRow.fundSolvent ? 'text-fg' : 'text-danger'
                        }`}
                      >
                        {formatMoney(headlineRow.closingFundBalance)}
                      </div>
                    </div>
                  </>
                )}
              </div>
              {hasShortfall && (
                <p className="text-xs text-danger border-t border-border pt-3">
                  {t('projections.headline.shortfallWarning').replace(
                    '{adjustment}',
                    formatAdjustment(r.solvencyScaleFactor),
                  )}
                </p>
              )}
              {r.plans.length === 0 ? (
                <p className="text-xs text-fg-muted">
                  {t('projections.headline.noPlans')}{' '}
                  <a href="/settings?tab=paymentPlans" className="text-accent hover:underline">
                    {t('projections.headline.plansLink')}
                  </a>
                  .
                </p>
              ) : headlineRow && r.plans.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm border-t border-border pt-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-fg-muted">
                      {t('projections.headline.adjustment')}
                    </div>
                    <div className="tabular font-semibold text-fg">
                      {headlineRow.projectedPlanIncome > 0
                        ? formatAdjustment(headlineRow.scaleFactor)
                        : '—'}
                    </div>
                  </div>
                </div>
              ) : null}
              {r.plans.length > 0 && headlineRow && headlineRow.projectedPlanIncome > 0 && (
                <ul className="space-y-1 text-xs text-fg-muted border-t border-border pt-3">
                  {headlineRow.planRecommendations.map((p) => (
                    <li key={p.planId} className="tabular">
                      {t('projections.headline.planRow')
                        .replace('{name}', p.planName)
                        .replace('{current}', formatMoney(p.currentPrice))
                        .replace('{recommended}', formatMoney(p.recommendedPrice))}
                    </li>
                  ))}
                </ul>
              )}
              {r.plans.length > 0 && r.currentPlanIncome === 0 && (
                <p className="text-xs text-fg-muted">{t('projections.headline.noIncome')}</p>
              )}
            </Card>

            {headlineRow && headlineRow.projectedPlanIncome > 0 && (
              <Card compact className="space-y-4">
                <h2 className="text-sm font-semibold text-fg">{t('projections.scenario.title')}</h2>
                <div>
                  <label className="block text-xs text-fg-muted mb-2">
                    {t('projections.scenario.duesChange')}: {duesChangePct >= 0 ? '+' : ''}
                    {duesChangePct}%
                  </label>
                  <input
                    type="range"
                    min={-20}
                    max={30}
                    step={5}
                    value={duesChangePct}
                    onChange={(e) => setDuesChangePct(Number(e.target.value))}
                    className="w-full accent-accent"
                  />
                </div>
                {scenario && (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm border-t border-border pt-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-fg-muted">
                          {t('projections.scenario.adjustedIncome')}
                        </div>
                        <div className="tabular font-semibold text-fg">
                          {formatMoney(scenario.adjustedPlanIncome)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-fg-muted">
                          {t('projections.scenario.adjustedClosing')}
                        </div>
                        <div
                          className={`tabular font-semibold ${
                            scenario.fundSolvent ? 'text-fg' : 'text-danger'
                          }`}
                        >
                          {formatMoney(scenario.adjustedClosingBalance)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-fg-muted">
                          {t('projections.scenario.adjustment')}
                        </div>
                        <div className="tabular font-semibold text-fg">
                          {formatScenarioAdjustment(scenario.adjustedScaleFactor)}
                        </div>
                      </div>
                    </div>
                    <p
                      className={`text-xs ${scenario.fundSolvent ? 'text-success' : 'text-danger'}`}
                    >
                      {scenario.fundSolvent
                        ? t('projections.scenario.solvent')
                        : t('projections.scenario.shortfall')}
                    </p>
                    {duesChangePct !== 0 && (
                      <ul className="space-y-1 text-xs text-fg-muted border-t border-border pt-3">
                        {scenario.planRecommendations.map((p) => (
                          <li key={p.planId} className="tabular">
                            {t('projections.scenario.planRow')
                              .replace('{name}', p.planName)
                              .replace('{current}', formatMoney(p.currentPrice))
                              .replace('{recommended}', formatMoney(p.recommendedPrice))}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </Card>
            )}

            <Card
              compact
              className="space-y-3 sm:space-y-0 sm:flex sm:flex-wrap sm:items-end sm:gap-6"
            >
              <ControlGroup label={t('projections.control.growthLookback')}>
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
                  {t('projections.control.growthSummary')
                    .replace('{years}', String(r.growthLookbackYears))
                    .replace('{yearLabel}', yearLabel)}
                  <br />
                  {t('projections.control.newFamilies').replace(
                    '{count}',
                    r.avgNewFamiliesPerYear.toFixed(1),
                  )}
                  ,{' '}
                  {t('projections.control.newChildren').replace(
                    '{count}',
                    r.avgNewChildrenPerYear.toFixed(1),
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
              <DataView
                tableId="projections-multi-year"
                rows={r.multiYear}
                columns={multiYearColumns}
                rowKey={(row) => String(row.year)}
                toolbar={false}
                defaultSort={{ id: 'year', dir: 'asc' }}
                mobileCard={(row) => (
                  <Card compact>
                    <p className="font-medium tabular text-fg">
                      {row.year}
                      {row.year === currentYear && (
                        <span className="ml-2 text-[10px] uppercase text-accent">
                          {t('projections.table.thisYear')}
                        </span>
                      )}
                    </p>
                    <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <dt className="text-fg-muted">{t('projections.table.families')}</dt>
                        <dd className="tabular">{fmt(row.projectedFamilies)}</dd>
                      </div>
                      <div>
                        <dt className="text-fg-muted">{t('projections.table.totalPayers')}</dt>
                        <dd className="tabular">{fmt(row.projectedPayers)}</dd>
                      </div>
                      <div>
                        <dt className="text-fg-muted">{t('projections.table.closingFund')}</dt>
                        <dd
                          className={`tabular font-medium ${row.fundSolvent ? 'text-fg' : 'text-danger'}`}
                        >
                          {formatMoney(row.closingFundBalance)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-fg-muted">{t('projections.table.adjustment')}</dt>
                        <dd className="tabular">
                          {row.projectedPlanIncome > 0 ? formatAdjustment(row.scaleFactor) : '—'}
                        </dd>
                      </div>
                    </dl>
                  </Card>
                )}
              />
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
                          {t('projections.how.fundBalance')}
                        </span>{' '}
                        {formatMoney(r.openingFundBalance)} {t('projections.how.fundBalanceDesc')}
                      </p>
                      <p>
                        <span className="font-medium text-fg">
                          {t('projections.how.expectedExpenses')}
                        </span>{' '}
                        {formatMoney(startYearExpenses)} {t('projections.how.expectedExpensesDesc')}
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
                        ,{' '}
                        {t('projections.how.newChildrenGrowth').replace(
                          '{count}',
                          r.avgNewChildrenPerYear.toFixed(1),
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
                        <DataView
                          tableId="projections-per-event"
                          rows={r.perEvent}
                          columns={perEventColumns}
                          rowKey={(row) => row.eventTypeId}
                          toolbar={false}
                          defaultSort={{ id: 'name', dir: 'asc' }}
                          mobileCard={(row) => (
                            <Card compact>
                              <p className="font-medium text-fg">{row.name}</p>
                              <p className="mt-1 text-sm tabular text-fg-muted">
                                {t('projections.how.total')}:{' '}
                                {formatMoney(row.projectedExpenseStartYear)}
                              </p>
                            </Card>
                          )}
                        />
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

function formatAdjustment(scaleFactor: number): string {
  if (!Number.isFinite(scaleFactor) || scaleFactor === 0) return '0%'
  const pct = (scaleFactor - 1) * 100
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}
