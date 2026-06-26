'use client'

import { useCallback, useEffect, useState } from 'react'
import { QueueListIcon } from '@heroicons/react/24/outline'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useToast } from '@/app/components/Toast'
import {
  Badge,
  Card,
  DataView,
  EmptyState,
  PageHeader,
  SkeletonRows,
  type DataColumn,
} from '@/app/components/ui'
import { formatLocaleDate } from '@/lib/date-utils'
import { useT } from '@/lib/client/i18n'
import type { MessageKey } from '@/lib/i18n/load-locale'
import CommunicationsNav from './CommunicationsNav'
import type { EmailJobRow } from './types'

function statusVariant(status: string): 'default' | 'success' | 'warning' | 'danger' {
  if (status === 'completed') return 'success'
  if (status === 'running' || status === 'queued') return 'warning'
  if (status === 'failed') return 'danger'
  return 'default'
}

function kindLabel(kind: string, t: ReturnType<typeof useT>) {
  const key = `communications.jobs.kind.${kind}` as MessageKey
  const fallbacks: Record<string, string> = {
    communications: 'Bulk email',
    statements: 'Statements',
    'tax-receipts': 'Tax receipts',
  }
  return t(key, fallbacks[kind] ?? kind)
}

export default function JobsView() {
  const t = useT()
  const toast = useToast()
  const [rows, setRows] = useState<EmailJobRow[]>([])
  const [loading, setLoading] = useState(true)

  const loadJobs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/emails/jobs?limit=50')
      if (!res.ok) throw new Error('Failed to load jobs')
      const data = await res.json()
      setRows((data.items ?? []) as EmailJobRow[])
    } catch {
      toast.error(t('communications.jobs.loadError'))
    } finally {
      setLoading(false)
    }
  }, [toast, t])

  useEffect(() => {
    void loadJobs()
  }, [loadJobs])

  useOrgChanged(() => {
    void loadJobs()
  })

  const columns: DataColumn<EmailJobRow>[] = [
    {
      id: 'date',
      header: t('communications.jobs.column.date'),
      headerText: t('communications.jobs.column.date'),
      cell: (row) => (
        <span className="tabular text-fg-muted">
          {row.createdAt ? formatLocaleDate(row.createdAt) : '—'}
        </span>
      ),
      exportValue: (row) => (row.createdAt ? new Date(row.createdAt) : ''),
    },
    {
      id: 'kind',
      header: t('communications.jobs.column.kind'),
      headerText: t('communications.jobs.column.kind'),
      cell: (row) => <span className="text-fg">{kindLabel(row.kind, t)}</span>,
      exportValue: (row) => row.kind,
    },
    {
      id: 'status',
      header: t('communications.jobs.column.status'),
      headerText: t('communications.jobs.column.status'),
      cell: (row) => (
        <Badge size="sm" variant={statusVariant(row.status)}>
          {row.status}
        </Badge>
      ),
      exportValue: (row) => row.status,
    },
    {
      id: 'progress',
      header: t('communications.jobs.column.progress'),
      headerText: t('communications.jobs.column.progress'),
      cell: (row) => (
        <span className="tabular text-fg-muted">
          {row.processed}/{row.totalFamilies}
        </span>
      ),
      exportValue: (row) => `${row.processed}/${row.totalFamilies}`,
    },
    {
      id: 'sent',
      header: t('communications.jobs.column.sent'),
      headerText: t('communications.jobs.column.sent'),
      align: 'right',
      cell: (row) => <span className="tabular">{row.sent}</span>,
      exportValue: (row) => row.sent,
    },
    {
      id: 'failed',
      header: t('communications.jobs.column.failed'),
      headerText: t('communications.jobs.column.failed'),
      align: 'right',
      cell: (row) => (
        <span className={`tabular ${row.failed > 0 ? 'text-danger' : ''}`}>{row.failed}</span>
      ),
      exportValue: (row) => row.failed,
    },
    {
      id: 'error',
      header: t('communications.jobs.column.error'),
      headerText: t('communications.jobs.column.error'),
      hideBelow: 'md',
      cell: (row) => (
        <span
          className="text-sm text-danger truncate max-w-xs block"
          title={row.lastError ?? undefined}
        >
          {row.lastError || '—'}
        </span>
      ),
      exportValue: (row) => row.lastError || '',
    },
  ]

  return (
    <div className="min-h-screen p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <PageHeader
          title={t('communications.jobs.title')}
          subtitle={t('communications.jobs.subtitle')}
        />

        <CommunicationsNav />

        <Card className="overflow-hidden">
          {loading ? (
            <div className="p-4">
              <SkeletonRows count={6} />
            </div>
          ) : (
            <DataView
              tableId="email-jobs"
              rows={rows}
              columns={columns}
              rowKey={(r) => r.jobId}
              pageSize={15}
              exportFileName="email-jobs"
              mobileCard={(row) => (
                <Card compact>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-fg">{kindLabel(row.kind, t)}</p>
                    <Badge size="sm" variant={statusVariant(row.status)}>
                      {row.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-fg-muted mt-1">
                    {row.createdAt ? formatLocaleDate(row.createdAt) : '—'} · {row.sent} sent ·{' '}
                    {row.failed} failed
                  </p>
                  <p className="text-xs text-fg-muted mt-1 tabular">
                    {row.processed}/{row.totalFamilies} processed
                  </p>
                </Card>
              )}
              empty={
                <EmptyState
                  icon={<QueueListIcon className="h-10 w-10" />}
                  title={t('communications.jobs.empty')}
                  description={t('communications.jobs.emptyHint')}
                />
              }
            />
          )}
        </Card>
      </div>
    </div>
  )
}
