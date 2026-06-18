'use client'

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { CalendarIcon, ChartBarIcon } from '@heroicons/react/24/outline'
import { useToast } from '@/app/components/Toast'
import { useCurrency } from '@/lib/client/useCurrency'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useRequestGeneration } from '@/lib/client/useRequestGeneration'
import type { PlReportData } from '@/lib/reports/pl-data'
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  DataView,
  EmptyState,
  PageHeader,
  type DataColumn,
} from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'

type Transaction = PlReportData['transactions'][number]

const REPORTS_VISITED_KEY = 'kasa:reports:visited'

export interface ReportsViewProps {
  initialReportData?: PlReportData | null
  initialYear?: number
}

export default function ReportsView({
  initialReportData = null,
  initialYear = new Date().getFullYear(),
}: ReportsViewProps = {}) {
  const toast = useToast()
  const t = useT()
  const { format: formatMoney } = useCurrency()
  const [loading, setLoading] = useState(false)
  const [reportData, setReportData] = useState<PlReportData | null>(initialReportData)
  const [reportType, setReportType] = useState<'year' | 'range'>('year')
  const [year, setYear] = useState(initialYear)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const { begin, invalidate, isStale } = useRequestGeneration()
  const deferredGenerateRef = useRef(false)

  useOrgChanged(
    useCallback(() => {
      invalidate()
      setReportData(null)
      deferredGenerateRef.current = false
    }, [invalidate]),
  )

  const generateReport = useCallback(async () => {
    const gen = begin()
    setLoading(true)
    try {
      let url = '/api/reports/pl?'
      if (reportType === 'year') {
        url += `year=${year}`
      } else {
        if (!startDate || !endDate) {
          toast.error(t('reports.error.dateRange'))
          if (!isStale(gen)) setLoading(false)
          return
        }
        url += `startDate=${startDate}&endDate=${endDate}`
      }

      const res = await fetch(url)
      if (isStale(gen)) return
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || t('reports.error.generate'))
        return
      }
      const data = await res.json().catch(() => ({}))
      if (isStale(gen)) return
      setReportData(data)
    } catch {
      if (isStale(gen)) return
      toast.error(t('reports.error.generate'))
    } finally {
      if (!isStale(gen)) setLoading(false)
    }
  }, [begin, isStale, reportType, year, startDate, endDate, toast, t])

  useEffect(() => {
    if (initialReportData || deferredGenerateRef.current) return
    deferredGenerateRef.current = true

    let visitedBefore = false
    try {
      visitedBefore = sessionStorage.getItem(REPORTS_VISITED_KEY) === '1'
      sessionStorage.setItem(REPORTS_VISITED_KEY, '1')
    } catch {
      // sessionStorage unavailable — skip idle prefetch
    }

    if (!visitedBefore) return

    const schedule =
      typeof requestIdleCallback === 'function'
        ? (cb: () => void) => requestIdleCallback(cb) as unknown as number
        : (cb: () => void) => window.setTimeout(cb, 0)
    const cancel =
      typeof cancelIdleCallback === 'function'
        ? (id: number) => cancelIdleCallback(id)
        : (id: number) => window.clearTimeout(id)
    const id = schedule(() => {
      generateReport()
    })
    return () => cancel(id)
  }, [initialReportData, generateReport])

  const reportFileName = useMemo(() => {
    const base =
      reportType === 'year'
        ? `PL_Report_${year}`
        : `PL_Report_${startDate || 'start'}_to_${endDate || 'end'}`
    return base
  }, [reportType, year, startDate, endDate])

  const columns: DataColumn<Transaction>[] = useMemo(
    () => [
      {
        id: 'type',
        header: t('reports.column.type'),
        headerText: t('reports.column.type'),
        cell: (row) => (
          <Badge
            variant={row.type === 'Income' ? 'success' : 'danger'}
            size="md"
            className="rounded-full normal-case tracking-normal"
          >
            {row.type === 'Income' ? t('reports.type.income') : t('reports.type.expense')}
          </Badge>
        ),
        exportValue: (row) => row.type,
        filter: { type: 'select' },
      },
      {
        id: 'date',
        header: t('reports.column.date'),
        headerText: t('reports.column.date'),
        cell: (row) => <span className="tabular">{new Date(row.date).toLocaleDateString()}</span>,
        exportValue: (row) => (row.date ? new Date(row.date) : ''),
        filter: { type: 'dateRange', getValue: (row) => row.date || null },
      },
      {
        id: 'year',
        header: t('reports.column.year'),
        headerText: t('reports.column.year'),
        hideBelow: 'md',
        cell: (row) => <span className="text-fg-muted tabular">{row.year}</span>,
        exportValue: (row) => row.year,
        filter: { type: 'select', getValue: (row) => String(row.year) },
      },
      {
        id: 'family',
        header: t('reports.column.family'),
        headerText: t('reports.column.family'),
        cell: (row) => <span className="font-medium text-fg">{row.family}</span>,
        exportValue: (row) => row.family || '',
        filter: { type: 'select' },
      },
      {
        id: 'description',
        header: t('reports.column.description'),
        headerText: t('reports.column.description'),
        hideBelow: 'md',
        cell: (row) => <span className="text-fg-muted">{row.description}</span>,
        exportValue: (row) => row.description || '',
      },
      {
        id: 'amount',
        header: t('reports.column.amount'),
        headerText: t('reports.column.amount'),
        align: 'right',
        cell: (row) => (
          <span
            className={`font-medium tabular ${row.amount >= 0 ? 'text-success' : 'text-danger'}`}
          >
            {formatMoney(row.amount)}
          </span>
        ),
        exportValue: (row) => row.amount,
        filter: { type: 'numberRange', getValue: (row) => row.amount || 0 },
      },
      {
        id: 'notes',
        header: t('reports.column.notes'),
        headerText: t('reports.column.notes'),
        hideBelow: 'lg',
        defaultHidden: true,
        cell: (row) => <span className="text-fg-muted text-sm">{row.notes || '—'}</span>,
        exportValue: (row) => row.notes || '',
      },
    ],
    [formatMoney, t],
  )

  return (
    <div className="min-h-screen p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto">
        <PageHeader
          title={t('reports.title')}
          subtitle={t('reports.subtitle')}
          actions={
            <ButtonLink href="/reports/builder" variant="secondary" size="sm">
              {t('reports.openBuilder')}
            </ButtonLink>
          }
        />

        <Card className="mb-6">
          <h2 className="text-lg font-semibold mb-4 text-fg">{t('reports.generate.title')}</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-fg mb-2">
                {t('reports.generate.period')}
              </label>
              <div className="flex gap-4">
                <label className="flex items-center text-sm text-fg">
                  <input
                    type="radio"
                    value="year"
                    checked={reportType === 'year'}
                    onChange={(e) => setReportType(e.target.value as 'year' | 'range')}
                    className="mr-2"
                  />
                  {t('reports.generate.byYear')}
                </label>
                <label className="flex items-center text-sm text-fg">
                  <input
                    type="radio"
                    value="range"
                    checked={reportType === 'range'}
                    onChange={(e) => setReportType(e.target.value as 'year' | 'range')}
                    className="mr-2"
                  />
                  {t('reports.generate.dateRange')}
                </label>
              </div>
            </div>

            {reportType === 'year' ? (
              <div>
                <label className="block text-sm font-medium text-fg mb-2">
                  {t('reports.generate.year')}
                </label>
                <input
                  type="number"
                  value={year}
                  onChange={(e) => setYear(parseInt(e.target.value))}
                  className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg outline-none"
                  min="2000"
                  max="2100"
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-fg mb-2">
                    {t('reports.generate.startDate')}
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-fg mb-2">
                    {t('reports.generate.endDate')}
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg outline-none"
                  />
                </div>
              </div>
            )}

            <Button
              onClick={generateReport}
              disabled={loading}
              leftIcon={<CalendarIcon className="h-5 w-5" />}
            >
              {loading ? t('reports.generate.loading') : t('reports.generate.button')}
            </Button>
          </div>
        </Card>

        {reportData && (
          <Card>
            <h2 className="text-xl font-semibold text-fg mb-4">{t('reports.results.title')}</h2>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
              <SummaryCard
                label={t('reports.summary.totalIncome')}
                value={formatMoney(reportData.summary.totalIncome)}
                tone="success"
              />
              <SummaryCard
                label={t('reports.summary.totalExpenses')}
                value={formatMoney(reportData.summary.totalExpenses)}
                tone="danger"
              />
              <SummaryCard
                label={t('reports.summary.netProfit')}
                value={formatMoney(reportData.summary.netProfit)}
                tone={reportData.summary.netProfit >= 0 ? 'success' : 'danger'}
              />
              <SummaryCard
                label={t('reports.summary.transactions')}
                value={String(reportData.summary.transactionCount)}
                tone="accent"
              />
            </div>

            <DataView
              tableId="reports-pl"
              rows={reportData.transactions}
              columns={columns}
              rowKey={(_row, i) => String(i)}
              exportFileName={reportFileName}
              globalSearch={{ placeholder: t('reports.searchPlaceholder') }}
              pageSize={25}
              mobileCard={(row) => (
                <Card compact>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-fg truncate">{row.family}</div>
                      <div className="text-xs text-fg-muted truncate">{row.description}</div>
                    </div>
                    <span
                      className={`font-medium tabular ${
                        row.amount >= 0 ? 'text-success' : 'text-danger'
                      }`}
                    >
                      {formatMoney(row.amount)}
                    </span>
                  </div>
                  <div className="mt-2 flex justify-between text-xs text-fg-muted">
                    <span>
                      {row.type === 'Income' ? t('reports.type.income') : t('reports.type.expense')}
                    </span>
                    <span className="tabular">{new Date(row.date).toLocaleDateString()}</span>
                  </div>
                </Card>
              )}
              empty={
                <EmptyState
                  icon={<ChartBarIcon className="h-10 w-10" />}
                  title={t('reports.empty.title')}
                  description={t('reports.empty.description')}
                />
              }
            />
          </Card>
        )}
      </div>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'success' | 'danger' | 'accent'
}) {
  const toneClass =
    tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-accent'
  return (
    <Card compact className="bg-app-subtle">
      <div className="text-xs text-fg-muted">{label}</div>
      <div className={`mt-1 text-xl sm:text-2xl font-bold tabular ${toneClass}`}>{value}</div>
    </Card>
  )
}
