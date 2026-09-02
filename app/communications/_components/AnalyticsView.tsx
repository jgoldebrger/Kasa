'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChartBarIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useToast } from '@/app/components/Toast'
import {
  Button,
  Card,
  DataView,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  type DataColumn,
  type SortDir,
} from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import type { EmailAnalytics, EmailAnalyticsBucket, TopCampaignRow } from './types'

const PERIOD_OPTIONS = ['30', '90'] as const

export default function AnalyticsView() {
  const t = useT()
  const toast = useToast()
  const [period, setPeriod] = useState<string>('30')
  const [data, setData] = useState<EmailAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [trendSort, setTrendSort] = useState<{ id: string; dir: SortDir } | null>({
    id: 'date',
    dir: 'desc',
  })
  const [campaignSort, setCampaignSort] = useState<{ id: string; dir: SortDir } | null>({
    id: 'sent',
    dir: 'desc',
  })

  const loadAnalytics = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/emails/analytics?days=${period}`)
      if (!res.ok) throw new Error('Failed to load analytics')
      const json = await res.json()
      const raw = (json.data ?? json) as Record<string, unknown>
      const totals = (raw.totals ?? raw.summary ?? {}) as Record<string, number | undefined>
      const rates = (raw.rates ?? {}) as Record<string, number | undefined>
      const normalized: EmailAnalytics = {
        summary: {
          sent: totals.sent ?? 0,
          opened: totals.opened ?? 0,
          clicked: totals.clicked ?? 0,
          failed: totals.failed ?? 0,
          openRate: rates.openRate ?? (raw.summary as EmailAnalytics['summary'])?.openRate,
          clickRate: rates.clickRate ?? (raw.summary as EmailAnalytics['summary'])?.clickRate,
        },
        buckets: (raw.buckets ?? raw.daily) as EmailAnalytics['buckets'],
        topCampaigns: raw.topCampaigns as TopCampaignRow[] | undefined,
      }
      setData(normalized)
    } catch {
      toast.error(t('communications.analytics.loadError'))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [period, toast, t])

  useEffect(() => {
    void loadAnalytics()
  }, [loadAnalytics])

  useOrgChanged(() => {
    void loadAnalytics()
  })

  const summary = data?.summary
  const buckets = data?.buckets ?? data?.daily ?? []
  const topCampaigns = data?.topCampaigns ?? []

  const formatRate = (rate?: number) => (rate != null ? `${Math.round(rate * 100)}%` : '—')

  const sortedBuckets = useMemo(() => {
    if (!trendSort) return buckets
    const dir = trendSort.dir === 'asc' ? 1 : -1
    return [...buckets].sort((a, b) => {
      switch (trendSort.id) {
        case 'date':
          return dir * a.date.localeCompare(b.date)
        case 'sent':
          return dir * ((a.sent ?? 0) - (b.sent ?? 0))
        case 'opened':
          return dir * ((a.opened ?? 0) - (b.opened ?? 0))
        case 'clicked':
          return dir * ((a.clicked ?? 0) - (b.clicked ?? 0))
        case 'failed':
          return dir * ((a.failed ?? 0) - (b.failed ?? 0))
        default:
          return 0
      }
    })
  }, [buckets, trendSort])

  const sortedTopCampaigns = useMemo(() => {
    if (!campaignSort) return topCampaigns
    const dir = campaignSort.dir === 'asc' ? 1 : -1
    return [...topCampaigns].sort((a, b) => {
      switch (campaignSort.id) {
        case 'subject': {
          const aVal = (a.subject || a.campaignId).toLowerCase()
          const bVal = (b.subject || b.campaignId).toLowerCase()
          return dir * aVal.localeCompare(bVal)
        }
        case 'sent':
          return dir * ((a.sent ?? 0) - (b.sent ?? 0))
        case 'openRate':
          return dir * ((a.openRate ?? 0) - (b.openRate ?? 0))
        case 'clickRate':
          return dir * ((a.clickRate ?? 0) - (b.clickRate ?? 0))
        default:
          return 0
      }
    })
  }, [topCampaigns, campaignSort])

  const trendColumns = useMemo<DataColumn<EmailAnalyticsBucket>[]>(
    () => [
      {
        id: 'date',
        header: t('communications.analytics.column.date'),
        headerText: t('communications.analytics.column.date'),
        sortable: true,
        cell: (row) => <span className="tabular text-fg">{row.date}</span>,
        exportValue: (row) => row.date,
      },
      {
        id: 'sent',
        header: t('communications.analytics.sent'),
        headerText: t('communications.analytics.sent'),
        align: 'right',
        sortable: true,
        cell: (row) => <span className="tabular">{row.sent ?? 0}</span>,
        exportValue: (row) => row.sent ?? 0,
      },
      {
        id: 'opened',
        header: t('communications.analytics.opened'),
        headerText: t('communications.analytics.opened'),
        align: 'right',
        sortable: true,
        cell: (row) => <span className="tabular">{row.opened ?? 0}</span>,
        exportValue: (row) => row.opened ?? 0,
      },
      {
        id: 'clicked',
        header: t('communications.analytics.clicked'),
        headerText: t('communications.analytics.clicked'),
        align: 'right',
        sortable: true,
        cell: (row) => <span className="tabular">{row.clicked ?? 0}</span>,
        exportValue: (row) => row.clicked ?? 0,
      },
      {
        id: 'failed',
        header: t('communications.analytics.failed'),
        headerText: t('communications.analytics.failed'),
        align: 'right',
        sortable: true,
        cell: (row) => (
          <span className={`tabular ${(row.failed ?? 0) > 0 ? 'text-danger' : ''}`}>
            {row.failed ?? 0}
          </span>
        ),
        exportValue: (row) => row.failed ?? 0,
      },
    ],
    [t],
  )

  const topCampaignColumns = useMemo<DataColumn<TopCampaignRow>[]>(
    () => [
      {
        id: 'subject',
        header: t('communications.analytics.campaignSubject'),
        headerText: t('communications.analytics.campaignSubject'),
        sortable: true,
        cell: (row) => (
          <span className="max-w-xs truncate text-fg">{row.subject || row.campaignId}</span>
        ),
        exportValue: (row) => row.subject || row.campaignId,
      },
      {
        id: 'sent',
        header: t('communications.analytics.sent'),
        headerText: t('communications.analytics.sent'),
        align: 'right',
        sortable: true,
        cell: (row) => <span className="tabular">{row.sent ?? 0}</span>,
        exportValue: (row) => row.sent ?? 0,
      },
      {
        id: 'openRate',
        header: t('communications.analytics.openRate'),
        headerText: t('communications.analytics.openRate'),
        align: 'right',
        sortable: true,
        cell: (row) => <span className="tabular">{formatRate(row.openRate)}</span>,
        exportValue: (row) => formatRate(row.openRate),
      },
      {
        id: 'clickRate',
        header: t('communications.analytics.clickRate'),
        headerText: t('communications.analytics.clickRate'),
        align: 'right',
        sortable: true,
        cell: (row) => <span className="tabular">{formatRate(row.clickRate)}</span>,
        exportValue: (row) => formatRate(row.clickRate),
      },
    ],
    [t],
  )

  const exportCsv = async () => {
    setExporting(true)
    try {
      const res = await fetch(`/api/emails/analytics?days=${period}&format=csv`)
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `email-analytics-${period}d.csv`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error(t('communications.analytics.exportError'))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="min-h-screen p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <PageHeader
          title={t('communications.analytics.title')}
          subtitle={t('communications.analytics.subtitle')}
          actions={
            <Select
              label={t('communications.analytics.period')}
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="w-40"
            >
              {PERIOD_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {t('communications.analytics.periodDays').replace('{days}', d)}
                </option>
              ))}
            </Select>
          }
        />

        {loading ? (
          <Card>
            <SkeletonRows count={4} />
          </Card>
        ) : !summary ? (
          <EmptyState
            icon={<ChartBarIcon className="h-10 w-10" />}
            title={t('communications.analytics.empty')}
            description={t('communications.analytics.emptyHint')}
          />
        ) : (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {(
                [
                  ['sent', summary.sent],
                  ['opened', summary.opened],
                  ['clicked', summary.clicked],
                  ['failed', summary.failed],
                ] as const
              ).map(([key, value]) => (
                <Card key={key} compact className="p-4">
                  <p className="text-xs text-fg-muted">
                    {t(`communications.analytics.${key}` as 'communications.analytics.sent')}
                  </p>
                  <p className="text-2xl font-semibold tabular text-fg mt-1">{value ?? 0}</p>
                </Card>
              ))}
              <Card compact className="p-4">
                <p className="text-xs text-fg-muted">{t('communications.analytics.rates')}</p>
                <p className="text-lg font-semibold tabular text-fg mt-1">
                  {formatRate(summary.openRate)} / {formatRate(summary.clickRate)}
                </p>
              </Card>
            </div>

            {buckets.length > 0 && (
              <Card className="overflow-hidden">
                <div className="border-b border-border p-4">
                  <h2 className="text-sm font-medium text-fg">
                    {t('communications.analytics.trend')}
                  </h2>
                </div>
                <DataView
                  tableId="email-analytics-trend"
                  rows={sortedBuckets}
                  columns={trendColumns}
                  rowKey={(row) => row.date}
                  sort={trendSort}
                  onSortChange={(id, dir) => setTrendSort({ id, dir })}
                  toolbar={false}
                  pageSize={15}
                  exportFileName={`email-analytics-trend-${period}d`}
                  mobileCard={(row) => (
                    <Card compact>
                      <p className="font-medium tabular text-fg">{row.date}</p>
                      <p className="mt-1 text-sm text-fg-muted tabular">
                        {t('communications.analytics.sent')}: {row.sent ?? 0} ·{' '}
                        {t('communications.analytics.opened')}: {row.opened ?? 0} ·{' '}
                        {t('communications.analytics.clicked')}: {row.clicked ?? 0} ·{' '}
                        {t('communications.analytics.failed')}: {row.failed ?? 0}
                      </p>
                    </Card>
                  )}
                />
              </Card>
            )}

            {topCampaigns.length > 0 && (
              <Card className="overflow-hidden">
                <div className="border-b border-border p-4">
                  <h2 className="text-sm font-medium text-fg">
                    {t('communications.analytics.topCampaigns')}
                  </h2>
                </div>
                <DataView
                  tableId="email-analytics-top-campaigns"
                  rows={sortedTopCampaigns}
                  columns={topCampaignColumns}
                  rowKey={(row) => row.campaignId}
                  sort={campaignSort}
                  onSortChange={(id, dir) => setCampaignSort({ id, dir })}
                  toolbar={false}
                  pageSize={10}
                  exportFileName={`email-analytics-campaigns-${period}d`}
                  mobileCard={(row) => (
                    <Card compact>
                      <p className="truncate font-medium text-fg">
                        {row.subject || row.campaignId}
                      </p>
                      <p className="mt-1 text-sm text-fg-muted tabular">
                        {t('communications.analytics.sent')}: {row.sent ?? 0} ·{' '}
                        {t('communications.analytics.openRate')}: {formatRate(row.openRate)} ·{' '}
                        {t('communications.analytics.clickRate')}: {formatRate(row.clickRate)}
                      </p>
                    </Card>
                  )}
                />
              </Card>
            )}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                loading={exporting}
                leftIcon={<ArrowDownTrayIcon className="h-4 w-4" />}
                onClick={() => void exportCsv()}
              >
                {t('communications.analytics.exportCsv')}
              </Button>
              <Button type="button" variant="secondary" onClick={() => void loadAnalytics()}>
                {t('communications.analytics.refresh')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
