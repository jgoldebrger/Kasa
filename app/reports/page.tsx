'use client'

import { useState, useMemo, useCallback } from 'react'
import { CalendarIcon, ChartBarIcon } from '@heroicons/react/24/outline'
import { useToast } from '@/app/components/Toast'
import { useCurrency } from '@/lib/client/useCurrency'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useRequestGeneration } from '@/lib/client/useRequestGeneration'
import {
  Button,
  DataView,
  EmptyState,
  PageHeader,
  type DataColumn,
} from '@/app/components/ui'

interface Transaction {
  type: string
  date: string
  year: number
  family: string
  description: string
  amount: number
  notes: string
}

interface ReportSummary {
  totalIncome: number
  totalExpenses: number
  netProfit: number
  transactionCount: number
  paymentCount: number
  eventCount: number
}

export default function ReportsPage() {
  const toast = useToast()
  const { format: formatMoney } = useCurrency()
  const [loading, setLoading] = useState(false)
  const [reportData, setReportData] = useState<{
    transactions: Transaction[]
    summary: ReportSummary
  } | null>(null)
  const [reportType, setReportType] = useState<'year' | 'range'>('year')
  const [year, setYear] = useState(new Date().getFullYear())
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const { begin, invalidate, isStale } = useRequestGeneration()

  useOrgChanged(useCallback(() => {
    invalidate()
    setReportData(null)
  }, [invalidate]))

  const generateReport = async () => {
    const gen = begin()
    setLoading(true)
    try {
      let url = '/api/reports/pl?'
      if (reportType === 'year') {
        url += `year=${year}`
      } else {
        if (!startDate || !endDate) {
          toast.error('Please select both start and end dates')
          if (!isStale(gen)) setLoading(false)
          return
        }
        url += `startDate=${startDate}&endDate=${endDate}`
      }

      const res = await fetch(url)
      if (isStale(gen)) return
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Failed to generate report')
        return
      }
      const data = await res.json().catch(() => ({}))
      if (isStale(gen)) return
      setReportData(data)
    } catch {
      if (isStale(gen)) return
      toast.error('Failed to generate report')
    } finally {
      if (!isStale(gen)) setLoading(false)
    }
  }

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
      header: 'Type',
      headerText: 'Type',
      cell: (t) => (
        <span
          className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
            t.type === 'Income'
              ? 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300'
              : 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300'
          }`}
        >
          {t.type}
        </span>
      ),
      exportValue: (t) => t.type,
      filter: { type: 'select' },
    },
    {
      id: 'date',
      header: 'Date',
      headerText: 'Date',
      cell: (t) => <span className="tabular">{new Date(t.date).toLocaleDateString()}</span>,
      exportValue: (t) => (t.date ? new Date(t.date) : ''),
      filter: { type: 'dateRange', getValue: (t) => t.date || null },
    },
    {
      id: 'year',
      header: 'Year',
      headerText: 'Year',
      hideBelow: 'md',
      cell: (t) => <span className="text-fg-muted tabular">{t.year}</span>,
      exportValue: (t) => t.year,
      filter: { type: 'select', getValue: (t) => String(t.year) },
    },
    {
      id: 'family',
      header: 'Family',
      headerText: 'Family',
      cell: (t) => <span className="font-medium text-fg">{t.family}</span>,
      exportValue: (t) => t.family || '',
      filter: { type: 'select' },
    },
    {
      id: 'description',
      header: 'Description',
      headerText: 'Description',
      hideBelow: 'md',
      cell: (t) => <span className="text-fg-muted">{t.description}</span>,
      exportValue: (t) => t.description || '',
    },
    {
      id: 'amount',
      header: 'Amount',
      headerText: 'Amount',
      align: 'right',
      cell: (t) => (
        <span
          className={`font-medium tabular ${
            t.amount >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'
          }`}
        >
          {formatMoney(t.amount)}
        </span>
      ),
      exportValue: (t) => t.amount,
      filter: { type: 'numberRange', getValue: (t) => t.amount || 0 },
    },
    {
      id: 'notes',
      header: 'Notes',
      headerText: 'Notes',
      hideBelow: 'lg',
      defaultHidden: true,
      cell: (t) => <span className="text-fg-muted text-sm">{t.notes || '—'}</span>,
      exportValue: (t) => t.notes || '',
    },
  ],
    [formatMoney],
  )

  return (
    <div className="min-h-screen p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto">
        <PageHeader
          title="Financial Reports"
          subtitle="Generate a profit & loss report for a year or date range, then export it."
          actions={
            <a
              href="/reports/builder"
              className="focus-ring inline-flex items-center rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg hover:bg-fg/5"
            >
              Open report builder →
            </a>
          }
        />

        <div className="surface-card p-4 sm:p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4 text-fg">Generate P&amp;L Report</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-fg mb-2">Report Period</label>
              <div className="flex gap-4">
                <label className="flex items-center text-sm text-fg">
                  <input
                    type="radio"
                    value="year"
                    checked={reportType === 'year'}
                    onChange={(e) => setReportType(e.target.value as 'year' | 'range')}
                    className="mr-2"
                  />
                  By Year
                </label>
                <label className="flex items-center text-sm text-fg">
                  <input
                    type="radio"
                    value="range"
                    checked={reportType === 'range'}
                    onChange={(e) => setReportType(e.target.value as 'year' | 'range')}
                    className="mr-2"
                  />
                  Date Range
                </label>
              </div>
            </div>

            {reportType === 'year' ? (
              <div>
                <label className="block text-sm font-medium text-fg mb-2">Year</label>
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
                  <label className="block text-sm font-medium text-fg mb-2">Start Date</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-fg mb-2">End Date</label>
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
              {loading ? 'Generating…' : 'Generate Report'}
            </Button>
          </div>
        </div>

        {reportData && (
          <div className="surface-card p-4 sm:p-6">
            <h2 className="text-xl font-semibold text-fg mb-4">Report Results</h2>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
              <SummaryCard label="Total Income" value={formatMoney(reportData.summary.totalIncome)} tone="success" />
              <SummaryCard label="Total Expenses" value={formatMoney(reportData.summary.totalExpenses)} tone="danger" />
              <SummaryCard
                label="Net Profit/Loss"
                value={formatMoney(reportData.summary.netProfit)}
                tone={reportData.summary.netProfit >= 0 ? 'success' : 'danger'}
              />
              <SummaryCard label="Transactions" value={String(reportData.summary.transactionCount)} tone="accent" />
            </div>

            <DataView
              tableId="reports-pl"
              rows={reportData.transactions}
              columns={columns}
              rowKey={(_t, i) => String(i)}
              exportFileName={reportFileName}
              globalSearch={{ placeholder: 'Search family, description, notes…' }}
              pageSize={25}
              mobileCard={(t) => (
                <div className="surface-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-fg truncate">{t.family}</div>
                      <div className="text-xs text-fg-muted truncate">{t.description}</div>
                    </div>
                    <span
                      className={`font-medium tabular ${
                        t.amount >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'
                      }`}
                    >
                      {formatMoney(t.amount)}
                    </span>
                  </div>
                  <div className="mt-2 flex justify-between text-xs text-fg-muted">
                    <span>{t.type}</span>
                    <span className="tabular">{new Date(t.date).toLocaleDateString()}</span>
                  </div>
                </div>
              )}
              empty={
                <EmptyState
                  icon={<ChartBarIcon className="h-10 w-10" />}
                  title="No transactions"
                  description="No transactions match the selected period."
                />
              }
            />
          </div>
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
    tone === 'success'
      ? 'text-green-700 dark:text-green-400'
      : tone === 'danger'
      ? 'text-red-700 dark:text-red-400'
      : 'text-accent'
  return (
    <div className="rounded-lg border border-border bg-app-subtle p-4">
      <div className="text-xs text-fg-muted">{label}</div>
      <div className={`mt-1 text-xl sm:text-2xl font-bold tabular ${toneClass}`}>{value}</div>
    </div>
  )
}
