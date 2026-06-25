'use client'

import { useCallback, useEffect, useState } from 'react'
import { ClockIcon } from '@heroicons/react/24/outline'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useToast } from '@/app/components/Toast'
import {
  Badge,
  Button,
  Card,
  DataView,
  EmptyState,
  PageHeader,
  SkeletonRows,
  type DataColumn,
} from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import type { MessageKey } from '@/lib/i18n/load-locale'
import CommunicationsNav from './CommunicationsNav'
import type { ScheduledEmailRow } from './types'

function tf(t: ReturnType<typeof useT>, key: string, fallback: string) {
  return t(key as MessageKey, fallback)
}

function formatScheduledFor(value: string) {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString()
}

function statusVariant(status: string): 'default' | 'success' | 'warning' | 'danger' {
  if (status === 'pending') return 'warning'
  if (status === 'sent') return 'success'
  if (status === 'cancelled') return 'default'
  if (status === 'failed') return 'danger'
  return 'default'
}

export default function ScheduledView() {
  const t = useT()
  const toast = useToast()
  const [rows, setRows] = useState<ScheduledEmailRow[]>([])
  const [loading, setLoading] = useState(true)
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  const loadScheduled = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/scheduled-emails')
      if (!res.ok) throw new Error('Failed to load scheduled emails')
      const data = await res.json()
      const list = (data.scheduledEmails ?? data.items ?? []) as ScheduledEmailRow[]
      setRows(list)
    } catch {
      toast.error(tf(t, 'communications.scheduled.loadError', 'Failed to load scheduled sends'))
    } finally {
      setLoading(false)
    }
  }, [toast, t])

  useEffect(() => {
    void loadScheduled()
  }, [loadScheduled])

  useOrgChanged(() => {
    void loadScheduled()
  })

  const cancelScheduled = async (id: string) => {
    const ok = window.confirm(
      tf(t, 'communications.scheduled.cancelConfirm', 'Cancel this scheduled send?'),
    )
    if (!ok) return
    setCancellingId(id)
    try {
      const res = await fetch(`/api/scheduled-emails/${id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Cancel failed')
      toast.success(tf(t, 'communications.scheduled.cancelled', 'Scheduled send cancelled'))
      setRows((prev) => prev.map((row) => (row._id === id ? { ...row, status: 'cancelled' } : row)))
    } catch (err: unknown) {
      toast.error(
        err instanceof Error
          ? err.message
          : tf(t, 'communications.scheduled.cancelError', 'Cancel failed'),
      )
    } finally {
      setCancellingId(null)
    }
  }

  const pending = rows.filter((r) => r.status === 'pending')

  const columns: DataColumn<ScheduledEmailRow>[] = [
    {
      id: 'scheduledFor',
      header: tf(t, 'communications.scheduled.column.when', 'Scheduled for'),
      headerText: tf(t, 'communications.scheduled.column.when', 'Scheduled for'),
      cell: (row) => (
        <span className="tabular text-fg">{formatScheduledFor(row.scheduledFor)}</span>
      ),
      exportValue: (row) => row.scheduledFor,
    },
    {
      id: 'subject',
      header: t('communications.column.subject'),
      headerText: t('communications.column.subject'),
      cell: (row) => <span className="truncate max-w-md block">{row.subject}</span>,
      exportValue: (row) => row.subject,
    },
    {
      id: 'recipients',
      header: tf(t, 'communications.scheduled.column.recipients', 'Recipients'),
      headerText: tf(t, 'communications.scheduled.column.recipients', 'Recipients'),
      align: 'right',
      cell: (row) => <span className="tabular text-fg-muted">{row.familyIds?.length ?? 0}</span>,
      exportValue: (row) => row.familyIds?.length ?? 0,
    },
    {
      id: 'status',
      header: t('communications.column.status'),
      headerText: t('communications.column.status'),
      cell: (row) => (
        <Badge size="sm" variant={statusVariant(row.status)}>
          {row.status}
        </Badge>
      ),
      exportValue: (row) => row.status,
    },
    {
      id: 'actions',
      header: '',
      headerText: '',
      align: 'right',
      cell: (row) =>
        row.status === 'pending' ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            loading={cancellingId === row._id}
            onClick={(e) => {
              e.stopPropagation()
              void cancelScheduled(row._id)
            }}
          >
            {tf(t, 'communications.scheduled.cancel', 'Cancel')}
          </Button>
        ) : null,
      exportValue: () => '',
    },
  ]

  return (
    <div className="min-h-screen p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <PageHeader
          title={tf(t, 'communications.scheduled.title', 'Scheduled sends')}
          subtitle={tf(
            t,
            'communications.scheduled.subtitle',
            'Pending bulk emails waiting to go out.',
          )}
        />

        <CommunicationsNav />

        {loading ? (
          <Card>
            <SkeletonRows count={5} />
          </Card>
        ) : (
          <DataView
            tableId="scheduled-emails"
            rows={rows}
            columns={columns}
            rowKey={(r) => r._id}
            pageSize={15}
            exportFileName="scheduled-emails"
            toolbar={
              pending.length > 0
                ? {
                    left: (
                      <p className="text-sm text-fg-muted">
                        {tf(t, 'communications.scheduled.pendingCount', '{count} pending').replace(
                          '{count}',
                          String(pending.length),
                        )}
                      </p>
                    ),
                  }
                : undefined
            }
            mobileCard={(row) => (
              <Card compact className="space-y-2">
                <p className="font-medium text-fg truncate">{row.subject}</p>
                <p className="text-sm text-fg-muted tabular">
                  {formatScheduledFor(row.scheduledFor)}
                </p>
                <div className="flex items-center justify-between gap-2">
                  <Badge size="sm" variant={statusVariant(row.status)}>
                    {row.status}
                  </Badge>
                  <span className="text-xs text-fg-muted tabular">
                    {row.familyIds?.length ?? 0}{' '}
                    {tf(t, 'communications.scheduled.recipients', 'recipients')}
                  </span>
                </div>
                {row.status === 'pending' && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    loading={cancellingId === row._id}
                    onClick={() => void cancelScheduled(row._id)}
                  >
                    {tf(t, 'communications.scheduled.cancel', 'Cancel')}
                  </Button>
                )}
              </Card>
            )}
            empty={
              <EmptyState
                icon={<ClockIcon className="h-10 w-10" />}
                title={tf(t, 'communications.scheduled.empty', 'No scheduled sends')}
                description={tf(
                  t,
                  'communications.scheduled.emptyHint',
                  'Schedule a bulk email from the compose screen.',
                )}
                cta={{
                  label: tf(t, 'communications.templates.goCompose', 'Go to compose'),
                  href: '/communications',
                }}
              />
            }
          />
        )}
      </div>
    </div>
  )
}
