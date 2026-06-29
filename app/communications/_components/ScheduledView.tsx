'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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
import ScheduledEmailDetailDrawer from './ScheduledEmailDetailDrawer'
import type { FamilyOption, ScheduledEmailRow } from './types'

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

function statusLabel(status: string, t: ReturnType<typeof useT>): string {
  const key = `communications.scheduled.status.${status}` as MessageKey
  const fallbacks: Record<string, string> = {
    pending: 'Pending',
    sent: 'Sent',
    cancelled: 'Cancelled',
    failed: 'Failed',
  }
  return t(key, fallbacks[status] ?? status)
}

export default function ScheduledView() {
  const t = useT()
  const toast = useToast()
  const [rows, setRows] = useState<ScheduledEmailRow[]>([])
  const [families, setFamilies] = useState<FamilyOption[]>([])
  const [loading, setLoading] = useState(true)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)

  const familyById = useMemo(() => new Map(families.map((f) => [f._id, f])), [families])

  const loadFamilies = useCallback(async () => {
    try {
      const res = await fetch('/api/families?limit=500')
      if (!res.ok) return
      const data = await res.json()
      setFamilies((data.items ?? []) as FamilyOption[])
    } catch {
      // Non-fatal — detail view falls back to ids
    }
  }, [])

  const loadScheduled = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/scheduled-emails')
      if (!res.ok) throw new Error('Failed to load scheduled emails')
      const data = await res.json()
      const list = (data.scheduledEmails ?? data.items ?? []) as ScheduledEmailRow[]
      setRows(list)
    } catch {
      toast.error(t('communications.scheduled.loadError'))
    } finally {
      setLoading(false)
    }
  }, [toast, t])

  useEffect(() => {
    void loadScheduled()
    void loadFamilies()
  }, [loadScheduled, loadFamilies])

  useOrgChanged(() => {
    void loadScheduled()
    void loadFamilies()
  })

  const cancelScheduled = async (id: string) => {
    const ok = window.confirm(t('communications.scheduled.cancelConfirm'))
    if (!ok) return
    setCancellingId(id)
    try {
      const res = await fetch(`/api/scheduled-emails/${id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Cancel failed')
      toast.success(t('communications.scheduled.cancelled'))
      setRows((prev) => prev.map((row) => (row._id === id ? { ...row, status: 'cancelled' } : row)))
      if (detailId === id) setDetailId(null)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('communications.scheduled.cancelError'))
    } finally {
      setCancellingId(null)
    }
  }

  const recipientSummary = (row: ScheduledEmailRow) => {
    const count = row.familyIds?.length ?? 0
    return t('communications.scheduled.recipients').replace('{count}', String(count))
  }

  const pending = rows.filter((r) => r.status === 'pending')
  const detailRow = detailId ? (rows.find((r) => r._id === detailId) ?? null) : null

  const columns: DataColumn<ScheduledEmailRow>[] = [
    {
      id: 'scheduledFor',
      header: t('communications.scheduled.column.when'),
      headerText: t('communications.scheduled.column.when'),
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
      header: t('communications.scheduled.column.recipients'),
      headerText: t('communications.scheduled.column.recipients'),
      cell: (row) => <span className="text-fg-muted">{recipientSummary(row)}</span>,
      exportValue: (row) => row.familyIds?.length ?? 0,
    },
    {
      id: 'status',
      header: t('communications.column.status'),
      headerText: t('communications.column.status'),
      cell: (row) => (
        <Badge size="sm" variant={statusVariant(row.status)}>
          {statusLabel(row.status, t)}
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
            {t('communications.scheduled.cancel')}
          </Button>
        ) : null,
      exportValue: () => '',
    },
  ]

  return (
    <div className="min-h-screen p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <PageHeader
          title={t('communications.scheduled.title')}
          subtitle={t('communications.scheduled.subtitle')}
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
            onRowClick={(row) => setDetailId(row._id)}
            toolbar={
              pending.length > 0
                ? {
                    left: (
                      <p className="text-sm text-fg-muted">
                        {t('communications.scheduled.pendingCount').replace(
                          '{count}',
                          String(pending.length),
                        )}
                      </p>
                    ),
                  }
                : undefined
            }
            mobileCard={(row) => (
              <Card
                compact
                className="space-y-2 cursor-pointer hover:bg-app-subtle"
                onClick={() => setDetailId(row._id)}
              >
                <p className="font-medium text-fg truncate">{row.subject}</p>
                <p className="text-sm text-fg-muted tabular">
                  {formatScheduledFor(row.scheduledFor)}
                </p>
                <div className="flex items-center justify-between gap-2">
                  <Badge size="sm" variant={statusVariant(row.status)}>
                    {statusLabel(row.status, t)}
                  </Badge>
                  <span className="text-xs text-fg-muted">{recipientSummary(row)}</span>
                </div>
                {row.status === 'pending' && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    loading={cancellingId === row._id}
                    onClick={(e) => {
                      e.stopPropagation()
                      void cancelScheduled(row._id)
                    }}
                  >
                    {t('communications.scheduled.cancel')}
                  </Button>
                )}
              </Card>
            )}
            empty={
              <EmptyState
                icon={<ClockIcon className="h-10 w-10" />}
                title={t('communications.scheduled.empty')}
                description={t('communications.scheduled.emptyHint')}
                cta={{
                  label: t('communications.templates.goCompose'),
                  href: '/communications',
                }}
              />
            }
          />
        )}
      </div>

      <ScheduledEmailDetailDrawer
        row={detailRow}
        familyById={familyById}
        cancelling={cancellingId === detailId}
        onClose={() => setDetailId(null)}
        onCancel={(id) => void cancelScheduled(id)}
      />
    </div>
  )
}
