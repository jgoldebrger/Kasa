'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { ArrowPathIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { formatLocaleDate } from '@/lib/date-utils'
import { useToast } from '@/app/components/Toast'
import { Badge, Button, SkeletonRows } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import type { EmailDetail } from './types'

interface EmailDetailDrawerProps {
  emailId: string | null
  onClose: () => void
  onRetrySuccess?: () => void
}

function statusBadge(status: string): 'default' | 'success' | 'warning' | 'danger' {
  const map: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
    sent: 'default',
    opened: 'success',
    clicked: 'success',
    failed: 'danger',
    queued: 'warning',
  }
  return map[status] ?? 'default'
}

function eventLabel(type: string, t: ReturnType<typeof useT>): string {
  switch (type) {
    case 'sent':
      return t('communications.detail.event.sent')
    case 'opened':
      return t('communications.detail.event.opened')
    case 'clicked':
      return t('communications.detail.event.clicked')
    case 'failed':
      return t('communications.detail.event.failed')
    case 'bounced':
      return t('communications.detail.event.bounced')
    default:
      return type
  }
}

export default function EmailDetailDrawer({
  emailId,
  onClose,
  onRetrySuccess,
}: EmailDetailDrawerProps) {
  const t = useT()
  const toast = useToast()
  const [detail, setDetail] = useState<EmailDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [retrying, setRetrying] = useState(false)

  const load = useCallback(async () => {
    if (!emailId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/emails/${emailId}`)
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setDetail((data.email ?? data) as EmailDetail)
    } catch {
      toast.error(t('communications.detail.error'))
      setDetail(null)
    } finally {
      setLoading(false)
    }
  }, [emailId, toast, t])

  useEffect(() => {
    if (emailId) void load()
    else setDetail(null)
  }, [emailId, load])

  useEffect(() => {
    if (!emailId) return
    const timer = window.setInterval(() => {
      void load()
    }, 12_000)
    return () => window.clearInterval(timer)
  }, [emailId, load])

  useEffect(() => {
    if (!emailId) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [emailId, onClose])

  const retry = async () => {
    if (!emailId) return
    setRetrying(true)
    try {
      const res = await fetch(`/api/emails/${emailId}/retry`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Retry failed')
      toast.success(t('communications.detail.retrySuccess'))
      void load()
      onRetrySuccess?.()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('communications.detail.retryError'))
    } finally {
      setRetrying(false)
    }
  }

  if (!emailId || typeof document === 'undefined') return null

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
        aria-label={t('communications.detail.title')}
        className="relative h-full w-full max-w-md bg-surface border-s border-border shadow-2xl animate-ui-slide flex flex-col"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold text-fg">{t('communications.detail.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('communications.detail.close')}
            className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md text-fg-muted hover:bg-fg/5"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading ? (
            <SkeletonRows count={5} />
          ) : detail ? (
            <>
              <div className="space-y-2">
                <p className="text-sm font-medium text-fg">{detail.subject}</p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                  <span>{detail.to}</span>
                  {detail.familyId && (
                    <>
                      <span>·</span>
                      <Link
                        href={`/families/${detail.familyId}`}
                        className="text-accent hover:underline"
                      >
                        {detail.familyName || detail.to}
                      </Link>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge size="sm" variant={statusBadge(detail.status)}>
                    {detail.status}
                  </Badge>
                  <span className="text-xs text-fg-muted tabular">
                    {detail.openCount} / {detail.clickCount}
                  </span>
                </div>
                {detail.status === 'failed' && detail.error && (
                  <p className="text-sm text-danger">{detail.error}</p>
                )}
                {detail.openTracking &&
                  detail.openCount === 0 &&
                  (detail.status === 'sent' || detail.status === 'opened') && (
                    <p className="text-xs text-fg-muted">
                      {t('communications.detail.openTrackingHint')}
                    </p>
                  )}
              </div>

              {detail.events && detail.events.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-fg-muted uppercase tracking-wide mb-2">
                    {t('communications.detail.timeline')}
                  </h3>
                  <ol className="space-y-3 border-s-2 border-border ps-4">
                    {detail.events.map((ev, i) => (
                      <li key={`${ev.type}-${ev.timestamp}-${i}`} className="relative">
                        <span className="absolute -start-[1.3rem] top-1.5 h-2 w-2 rounded-full bg-accent" />
                        <p className="text-sm font-medium text-fg">{eventLabel(ev.type, t)}</p>
                        <p className="text-xs text-fg-muted tabular">
                          {ev.timestamp ? formatLocaleDate(ev.timestamp) : '—'}
                        </p>
                        {ev.url && (
                          <a
                            href={ev.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-accent hover:underline break-all"
                          >
                            {ev.url}
                          </a>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-fg-muted">{t('communications.detail.notFound')}</p>
          )}
        </div>

        {detail?.status === 'failed' && (
          <div className="border-t border-border p-4">
            <Button
              type="button"
              loading={retrying}
              leftIcon={<ArrowPathIcon className="h-4 w-4" />}
              onClick={() => void retry()}
              block
            >
              {t('communications.detail.retry')}
            </Button>
          </div>
        )}
      </aside>
    </div>,
    document.body,
  )
}
