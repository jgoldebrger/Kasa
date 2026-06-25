'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { EnvelopeIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline'
import { formatLocaleDate } from '@/lib/date-utils'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useToast } from '@/app/components/Toast'
import {
  Badge,
  Button,
  Card,
  DataView,
  EmptyState,
  Input,
  PageHeader,
  SkeletonRows,
  Textarea,
  type DataColumn,
} from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'

interface FamilyOption {
  _id: string
  name: string
  email?: string
}

interface EmailLogRow {
  _id: string
  familyId: string | null
  familyName: string | null
  to: string
  subject: string
  kind: string
  status: string
  openCount: number
  clickCount: number
  error: string | null
  createdAt: string
}

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
  const [sending, setSending] = useState(false)

  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

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
      const res = await fetch('/api/emails?limit=50')
      if (!res.ok) throw new Error('Failed to load emails')
      const data = await res.json()
      setLogs((data.items ?? []) as EmailLogRow[])
    } catch {
      toast.error(t('communications.error.loadLog'))
    } finally {
      setLoadingLogs(false)
    }
  }, [toast, t])

  useEffect(() => {
    void loadFamilies()
    void loadLogs()
  }, [loadFamilies, loadLogs])

  useOrgChanged(() => {
    setSelectedIds(new Set())
    void loadFamilies()
    void loadLogs()
  })

  const emailableFamilies = useMemo(() => families.filter((f) => f.email), [families])

  const toggleFamily = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () => {
    setSelectedIds(new Set(emailableFamilies.map((f) => f._id)))
  }

  const sendBulk = async () => {
    if (!subject.trim() || !body.trim()) {
      toast.error(t('communications.error.missingFields'))
      return
    }
    if (selectedIds.size === 0) {
      toast.error(t('communications.error.noRecipients'))
      return
    }

    const html = `<div style="font-family: Arial, sans-serif; line-height: 1.6;">${body
      .split('\n')
      .map((line) => `<p>${line.replace(/</g, '&lt;')}</p>`)
      .join('')}</div>`

    setSending(true)
    try {
      const res = await fetch('/api/emails/send-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          familyIds: Array.from(selectedIds),
          subject: subject.trim(),
          html: html.replace(/\{\{familyName\}\}/g, '{{familyName}}'),
          text: body,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Send failed')
      const sent = data.sent ?? 0
      const failed = data.failed ?? 0
      if (failed > 0 && Array.isArray(data.errors) && data.errors.length > 0) {
        toast.error(data.errors.slice(0, 2).join(' · '))
      }
      if (sent > 0) {
        toast.success(
          (t('communications.sendResult') || 'Sent: {sent}, failed: {failed}')
            .replace('{sent}', String(sent))
            .replace('{failed}', String(failed)),
        )
      }
      setSubject('')
      setBody('')
      setSelectedIds(new Set())
      setTab('log')
      void loadLogs()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('communications.error.send'))
    } finally {
      setSending(false)
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
          {row.status === 'failed' && row.error ? row.error : '—'}
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
          <Card className="p-4 sm:p-6 space-y-4">
            <Input
              label={t('communications.field.subject')}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t('communications.field.subjectPlaceholder')}
            />
            <Textarea
              label={t('communications.field.body')}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              placeholder={t('communications.field.bodyPlaceholder')}
              hint={t('communications.field.bodyHint')}
            />
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-fg">
                  {t('communications.field.recipients')}
                </label>
                <Button type="button" variant="ghost" size="sm" onClick={selectAll}>
                  {t('communications.selectAll')}
                </Button>
              </div>
              {loadingFamilies ? (
                <SkeletonRows count={4} />
              ) : emailableFamilies.length === 0 ? (
                <p className="text-sm text-fg-muted">{t('communications.noEmailableFamilies')}</p>
              ) : (
                <div className="max-h-64 overflow-y-auto border border-border rounded-lg divide-y divide-border">
                  {emailableFamilies.map((f) => (
                    <label
                      key={f._id}
                      className="flex items-center gap-3 px-3 py-2 hover:bg-app-subtle cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(f._id)}
                        onChange={() => toggleFamily(f._id)}
                        className="rounded border-border"
                      />
                      <span className="font-medium text-fg flex-1">{f.name}</span>
                      <span className="text-xs text-fg-muted truncate max-w-[12rem]">
                        {f.email}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <p className="text-xs text-fg-muted">{t('communications.trackingNotice')}</p>
            <Button
              loading={sending}
              onClick={() => void sendBulk()}
              leftIcon={<PaperAirplaneIcon className="h-4 w-4" />}
            >
              {t('communications.send').replace('{count}', String(selectedIds.size))}
            </Button>
          </Card>
        ) : loadingLogs ? (
          <Card>
            <SkeletonRows count={6} />
          </Card>
        ) : (
          <DataView
            tableId="email-log"
            rows={logs}
            columns={columns}
            rowKey={(r) => r._id}
            pageSize={15}
            exportFileName="email-log"
            mobileCard={(row) => (
              <Card compact>
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
                {row.status === 'failed' && row.error && (
                  <p className="text-xs text-danger mt-2 line-clamp-3">{row.error}</p>
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
      </div>
    </div>
  )
}
