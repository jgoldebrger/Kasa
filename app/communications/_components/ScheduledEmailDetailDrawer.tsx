'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { formatLocaleDate } from '@/lib/date-utils'
import { Badge, Button } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import type { MessageKey } from '@/lib/i18n/load-locale'
import type { FamilyOption, ScheduledEmailRow } from './types'

interface ScheduledEmailDetailDrawerProps {
  row: ScheduledEmailRow | null
  familyById: Map<string, FamilyOption>
  cancelling: boolean
  onClose: () => void
  onCancel: (id: string) => void
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

function formatWhen(value: string | null | undefined) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString()
}

export default function ScheduledEmailDetailDrawer({
  row,
  familyById,
  cancelling,
  onClose,
  onCancel,
}: ScheduledEmailDetailDrawerProps) {
  const t = useT()

  useEffect(() => {
    if (!row) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [row, onClose])

  if (!row || typeof document === 'undefined') return null

  const recipients = row.familyIds.map((id) => {
    const family = familyById.get(id)
    return {
      id,
      name: family?.name ?? id,
      email: family?.email,
    }
  })

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/40 animate-ui-fade"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t('communications.scheduled.detail.title')}
        className="relative h-full w-full max-w-lg bg-surface border-s border-border shadow-2xl animate-ui-slide flex flex-col"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold text-fg">
            {t('communications.scheduled.detail.title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('communications.scheduled.detail.close')}
            className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md text-fg-muted hover:bg-fg/5"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          <div className="space-y-2">
            <p className="text-sm font-medium text-fg">{row.subject}</p>
            <Badge size="sm" variant={statusVariant(row.status)}>
              {statusLabel(row.status, t)}
            </Badge>
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-fg-muted">{t('communications.scheduled.detail.scheduledFor')}</dt>
            <dd className="text-fg tabular">{formatWhen(row.scheduledFor)}</dd>

            {row.sentAt && (
              <>
                <dt className="text-fg-muted">{t('communications.scheduled.detail.sentAt')}</dt>
                <dd className="text-fg tabular">{formatWhen(row.sentAt)}</dd>
              </>
            )}

            {row.createdAt && (
              <>
                <dt className="text-fg-muted">{t('communications.scheduled.detail.createdAt')}</dt>
                <dd className="text-fg tabular">{formatLocaleDate(row.createdAt)}</dd>
              </>
            )}
          </dl>

          {row.status === 'failed' && row.error && (
            <div>
              <p className="text-xs font-medium text-fg-muted uppercase tracking-wide mb-1">
                {t('communications.scheduled.detail.error')}
              </p>
              <p className="text-sm text-danger">{row.error}</p>
            </div>
          )}

          <div>
            <p className="text-xs font-medium text-fg-muted uppercase tracking-wide mb-2">
              {t('communications.scheduled.detail.recipients').replace(
                '{count}',
                String(recipients.length),
              )}
            </p>
            <ul className="max-h-40 overflow-y-auto space-y-1 rounded-lg border border-border divide-y divide-border">
              {recipients.map((r) => (
                <li key={r.id} className="px-3 py-2 text-sm">
                  <Link
                    href={`/families/${r.id}`}
                    className="text-accent hover:underline font-medium"
                  >
                    {r.name}
                  </Link>
                  {r.email && <p className="text-xs text-fg-muted truncate">{r.email}</p>}
                </li>
              ))}
            </ul>
          </div>

          {row.html && (
            <div>
              <p className="text-xs font-medium text-fg-muted uppercase tracking-wide mb-2">
                {t('communications.scheduled.detail.body')}
              </p>
              <div
                className="rounded-lg border border-border bg-surface p-4 text-sm text-fg prose-sm max-w-none max-h-64 overflow-y-auto"
                dangerouslySetInnerHTML={{ __html: row.html }}
              />
            </div>
          )}
        </div>

        {row.status === 'pending' && (
          <div className="border-t border-border p-4">
            <Button
              type="button"
              variant="destructive"
              loading={cancelling}
              onClick={() => onCancel(row._id)}
              block
            >
              {t('communications.scheduled.cancel')}
            </Button>
          </div>
        )}
      </aside>
    </div>,
    document.body,
  )
}
