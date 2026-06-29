'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChartBarIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useToast } from '@/app/components/Toast'
import { Button, Card, EmptyState, PageHeader, Select, SkeletonRows } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import CommunicationsNav from './CommunicationsNav'
import type { EmailAnalytics, TopCampaignRow } from './types'

const PERIOD_OPTIONS = ['30', '90'] as const

export default function AnalyticsView() {
  const t = useT()
  const toast = useToast()
  const [period, setPeriod] = useState<string>('30')
  const [data, setData] = useState<EmailAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

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

        <CommunicationsNav />

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
                <div className="p-4 border-b border-border">
                  <h2 className="text-sm font-medium text-fg">
                    {t('communications.analytics.trend')}
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-app-subtle/50 text-left text-fg-muted">
                        <th className="px-4 py-2 font-medium">
                          {t('communications.analytics.column.date')}
                        </th>
                        <th className="px-4 py-2 font-medium text-right">
                          {t('communications.analytics.sent')}
                        </th>
                        <th className="px-4 py-2 font-medium text-right">
                          {t('communications.analytics.opened')}
                        </th>
                        <th className="px-4 py-2 font-medium text-right">
                          {t('communications.analytics.clicked')}
                        </th>
                        <th className="px-4 py-2 font-medium text-right">
                          {t('communications.analytics.failed')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {buckets.map((row) => (
                        <tr key={row.date} className="border-b border-border last:border-0">
                          <td className="px-4 py-2 tabular text-fg">{row.date}</td>
                          <td className="px-4 py-2 tabular text-right">{row.sent ?? 0}</td>
                          <td className="px-4 py-2 tabular text-right">{row.opened ?? 0}</td>
                          <td className="px-4 py-2 tabular text-right">{row.clicked ?? 0}</td>
                          <td className="px-4 py-2 tabular text-right text-danger">
                            {row.failed ?? 0}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {topCampaigns.length > 0 && (
              <Card className="overflow-hidden">
                <div className="p-4 border-b border-border">
                  <h2 className="text-sm font-medium text-fg">
                    {t('communications.analytics.topCampaigns')}
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-app-subtle/50 text-left text-fg-muted">
                        <th className="px-4 py-2 font-medium">
                          {t('communications.analytics.campaignSubject')}
                        </th>
                        <th className="px-4 py-2 font-medium text-right">
                          {t('communications.analytics.sent')}
                        </th>
                        <th className="px-4 py-2 font-medium text-right">
                          {t('communications.analytics.openRate')}
                        </th>
                        <th className="px-4 py-2 font-medium text-right">
                          {t('communications.analytics.clickRate')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {topCampaigns.map((row) => (
                        <tr key={row.campaignId} className="border-b border-border last:border-0">
                          <td className="px-4 py-2 text-fg max-w-xs truncate">
                            {row.subject || row.campaignId}
                          </td>
                          <td className="px-4 py-2 tabular text-right">{row.sent ?? 0}</td>
                          <td className="px-4 py-2 tabular text-right">
                            {formatRate(row.openRate)}
                          </td>
                          <td className="px-4 py-2 tabular text-right">
                            {formatRate(row.clickRate)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
