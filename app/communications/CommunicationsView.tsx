'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowDownTrayIcon, EnvelopeIcon } from '@heroicons/react/24/outline'
import { formatLocaleDate } from '@/lib/date-utils'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useToast } from '@/app/components/Toast'
import {
  Badge,
  Card,
  DataView,
  EmptyState,
  PageHeader,
  SkeletonRows,
  Button,
  type DataColumn,
} from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import ComposeTab from './_components/ComposeTab'
import EmailDetailDrawer from './_components/EmailDetailDrawer'
import CampaignStatsModal from './_components/CampaignStatsModal'
import CommunicationsNav from './_components/CommunicationsNav'
import EmailLogFilters, { type EmailLogFilterValues } from './_components/EmailLogFilters'
import BulkJobProgressBanner from './_components/BulkJobProgressBanner'
import { useBulkJobPoll } from './_components/useBulkJobPoll'
import type { EmailLogRow, FamilyOption } from './_components/types'

type Tab = 'compose' | 'log'

function statusBadge(status: string) {
  const map: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
    sent: 'default',
    opened: 'success',
    clicked: 'success',
    failed: 'danger',
    queued: 'warning',
  }
  return map[status] ?? 'default'
}

export default function CommunicationsView() {
  const t = useT()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('compose')
  const [families, setFamilies] = useState<FamilyOption[]>([])
  const [loadingFamilies, setLoadingFamilies] = useState(true)
  const [logs, setLogs] = useState<EmailLogRow[]>([])
  const [loadingLogs, setLoadingLogs] = useState(true)
  const [detailEmailId, setDetailEmailId] = useState<string | null>(null)
  const [campaignId, setCampaignId] = useState<string | null>(null)
  const [showCampaignStats, setShowCampaignStats] = useState(false)
  const [exportingCsv, setExportingCsv] = useState(false)
  const { status: jobStatus, polling: jobPolling, startPoll } = useBulkJobPoll()
  const [logFilters, setLogFilters] = useState<EmailLogFilterValues>({
    status: '',
    kind: '',
    dateFrom: '',
    dateTo: '',
  })
  const [appliedFilters, setAppliedFilters] = useState<EmailLogFilterValues>({
    status: '',
    kind: '',
    dateFrom: '',
    dateTo: '',
  })

  const loadFamilies = useCallback(async () => {
    setLoadingFamilies(true)
    try {
      const res = await fetch('/api/families?limit=500')
      if (!res.ok) throw new Error('Failed to load families')
      const data = await res.json()
      const list = (data.items ?? []) as FamilyOption[]
      setFamilies(list)
    } catch {
      toast.error(t('communications.error.loadFamilies'))
    } finally {
      setLoadingFamilies(false)
    }
  }, [toast, t])

  const loadLogs = useCallback(async () => {
    setLoadingLogs(true)
    try {
      const params = new URLSearchParams({ limit: '50' })
      if (appliedFilters.status) params.set('status', appliedFilters.status)
      if (appliedFilters.kind) params.set('kind', appliedFilters.kind)
      if (appliedFilters.dateFrom) params.set('dateFrom', appliedFilters.dateFrom)
      if (appliedFilters.dateTo) params.set('dateTo', appliedFilters.dateTo)
      const res = await fetch(`/api/emails?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to load emails')
      const data = await res.json()
      setLogs((data.items ?? []) as EmailLogRow[])
    } catch {
      toast.error(t('communications.error.loadLog'))
    } finally {
      setLoadingLogs(false)
    }
  }, [toast, t, appliedFilters])

  useEffect(() => {
    void loadFamilies()
    void loadLogs()
  }, [loadFamilies, loadLogs])

  useOrgChanged(() => {
    void loadFamilies()
    void loadLogs()
  })

  const handleSent = (result: { sent: number; failed: number; campaignId?: string }) => {
    setTab('log')
    void loadLogs()
    if (result.campaignId && (result.sent > 0 || result.failed > 0)) {
      setCampaignId(result.campaignId)
      setShowCampaignStats(true)
    }
  }

  const handleJobStarted = (info: {
    jobId: string
    totalFamilies: number
    campaignId?: string
  }) => {
    void startPoll(
      info.jobId,
      (result) => {
        handleSent({ ...result, campaignId: result.campaignId ?? info.campaignId })
      },
      info.campaignId,
    )
  }

  const exportCsv = async () => {
    setExportingCsv(true)
    try {
      const params = new URLSearchParams({ format: 'csv' })
      if (appliedFilters.status) params.set('status', appliedFilters.status)
      if (appliedFilters.kind) params.set('kind', appliedFilters.kind)
      if (appliedFilters.dateFrom) params.set('dateFrom', appliedFilters.dateFrom)
      if (appliedFilters.dateTo) params.set('dateTo', appliedFilters.dateTo)
      const res = await fetch(`/api/emails?${params.toString()}`)
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `email-log-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success(t('communications.export.success'))
    } catch {
      toast.error(t('communications.export.error'))
    } finally {
      setExportingCsv(false)
    }
  }

  const columns: DataColumn<EmailLogRow>[] = [
    {
      id: 'date',
      header: t('communications.column.date'),
      headerText: t('communications.column.date'),
      cell: (row) => (
        <span className="tabular text-fg-muted">
          {row.createdAt ? formatLocaleDate(row.createdAt) : '—'}
        </span>
      ),
      exportValue: (row) => (row.createdAt ? new Date(row.createdAt) : ''),
    },
    {
      id: 'family',
      header: t('communications.column.family'),
      headerText: t('communications.column.family'),
      cell: (row) =>
        row.familyId ? (
          <Link
            href={`/families/${row.familyId}`}
            className="text-accent hover:underline font-medium"
            onClick={(e) => e.stopPropagation()}
          >
            {row.familyName || row.to}
          </Link>
        ) : (
          <span>{row.to}</span>
        ),
      exportValue: (row) => row.familyName || row.to,
    },
    {
      id: 'subject',
      header: t('communications.column.subject'),
      headerText: t('communications.column.subject'),
      cell: (row) => <span className="truncate max-w-xs block">{row.subject}</span>,
      exportValue: (row) => row.subject,
    },
    {
      id: 'kind',
      header: t('communications.column.kind'),
      headerText: t('communications.column.kind'),
      hideBelow: 'md',
      cell: (row) => (
        <span className="text-fg-muted capitalize">{row.kind.replace(/-/g, ' ')}</span>
      ),
      exportValue: (row) => row.kind,
    },
    {
      id: 'status',
      header: t('communications.column.status'),
      headerText: t('communications.column.status'),
      cell: (row) => (
        <Badge size="sm" variant={statusBadge(row.status)}>
          {row.status}
        </Badge>
      ),
      exportValue: (row) => row.status,
    },
    {
      id: 'error',
      header: t('communications.column.error'),
      headerText: t('communications.column.error'),
      cell: (row) => (
        <span
          className="text-sm text-danger max-w-md block truncate"
          title={row.error || undefined}
        >
          {row.status === 'failed'
            ? row.error || 'Send failed — verify Settings → Email (Gmail app password).'
            : '—'}
        </span>
      ),
      exportValue: (row) => row.error || '',
    },
    {
      id: 'tracking',
      header: t('communications.column.tracking'),
      headerText: t('communications.column.tracking'),
      align: 'right',
      hideBelow: 'lg',
      cell: (row) => (
        <span className="tabular text-fg-muted text-xs">
          {row.openCount} / {row.clickCount}
        </span>
      ),
      exportValue: (row) => `${row.openCount}/${row.clickCount}`,
    },
  ]

  return (
    <div className="min-h-screen p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <PageHeader title={t('communications.title')} subtitle={t('communications.subtitle')} />

        <CommunicationsNav />

        {jobStatus && <BulkJobProgressBanner status={jobStatus} polling={jobPolling} />}

        <div className="flex gap-2 border-b border-border">
          <button
            type="button"
            onClick={() => setTab('compose')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === 'compose'
                ? 'border-accent text-accent'
                : 'border-transparent text-fg-muted hover:text-fg'
            }`}
          >
            {t('communications.tab.compose')}
          </button>
          <button
            type="button"
            onClick={() => setTab('log')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === 'log'
                ? 'border-accent text-accent'
                : 'border-transparent text-fg-muted hover:text-fg'
            }`}
          >
            {t('communications.tab.log')}
          </button>
        </div>

        {tab === 'compose' ? (
          <ComposeTab
            families={families}
            loadingFamilies={loadingFamilies}
            onSent={handleSent}
            onJobStarted={handleJobStarted}
          />
        ) : (
          <Card className="overflow-hidden">
            <EmailLogFilters
              values={logFilters}
              onChange={setLogFilters}
              loading={loadingLogs}
              onApply={() => setAppliedFilters({ ...logFilters })}
              onClear={() => {
                const empty = { status: '', kind: '', dateFrom: '', dateTo: '' }
                setLogFilters(empty)
                setAppliedFilters(empty)
              }}
              exportButton={
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={exportingCsv}
                  leftIcon={<ArrowDownTrayIcon className="h-4 w-4" />}
                  onClick={() => void exportCsv()}
                >
                  {t('communications.export.button')}
                </Button>
              }
            />
            {loadingLogs ? (
              <div className="p-4">
                <SkeletonRows count={6} />
              </div>
            ) : (
              <DataView
                tableId="email-log"
                rows={logs}
                columns={columns}
                rowKey={(r) => r._id}
                pageSize={15}
                exportFileName="email-log"
                onRowClick={(row) => setDetailEmailId(row._id)}
                mobileCard={(row) => (
                  <Card
                    compact
                    className="cursor-pointer hover:bg-app-subtle"
                    onClick={() => setDetailEmailId(row._id)}
                  >
                    <p className="font-medium text-fg truncate">{row.subject}</p>
                    <p className="text-sm text-fg-muted mt-1">
                      {row.familyName || row.to} ·{' '}
                      {row.createdAt ? formatLocaleDate(row.createdAt) : '—'}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge size="sm" variant={statusBadge(row.status)}>
                        {row.status}
                      </Badge>
                      <span className="text-xs text-fg-muted tabular">
                        {row.openCount}/{row.clickCount}
                      </span>
                    </div>
                    {row.status === 'failed' && (
                      <p className="text-xs text-danger mt-2 line-clamp-4">
                        {row.error ||
                          'Send failed. Check Settings → Email, then send a new test message.'}
                      </p>
                    )}
                  </Card>
                )}
                empty={
                  <EmptyState
                    icon={<EnvelopeIcon className="h-10 w-10" />}
                    title={t('communications.empty.title')}
                    description={t('communications.empty.description')}
                  />
                }
              />
            )}
          </Card>
        )}
      </div>

      <EmailDetailDrawer
        emailId={detailEmailId}
        onClose={() => setDetailEmailId(null)}
        onRetrySuccess={() => void loadLogs()}
      />

      <CampaignStatsModal
        open={showCampaignStats}
        campaignId={campaignId}
        onClose={() => {
          setShowCampaignStats(false)
          setCampaignId(null)
        }}
        onRetrySuccess={() => void loadLogs()}
      />
    </div>
  )
}
