'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { EnvelopeIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import { cachedFetch } from '@/lib/client-cache'
import { useOrgChanged } from '@/lib/client/useOrgChanged'
import { useRequestGeneration } from '@/lib/client/useRequestGeneration'
import { useT } from '@/lib/client/i18n'
import { Skeleton } from './ui/Skeleton'

export interface EmailSummary {
  failedLast7Days: number
  lastSentAt: string | null
  pendingScheduled: number
}

interface DashboardActionsResponse {
  emailSummary?: EmailSummary
}

const EMPTY_SUMMARY: EmailSummary = {
  failedLast7Days: 0,
  lastSentAt: null,
  pendingScheduled: 0,
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return '—'
  const diffMs = Date.now() - then
  const minutes = Math.round(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(iso).toLocaleDateString()
}

export default function EmailDashboardCard() {
  const t = useT()
  const [summary, setSummary] = useState<EmailSummary>(EMPTY_SUMMARY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const hasFetchedRef = useRef(false)
  const { begin, invalidate, isStale } = useRequestGeneration()

  const fetchSummary = useCallback(async () => {
    const gen = begin()
    setError(false)
    try {
      const data = await cachedFetch<DashboardActionsResponse>('/api/dashboard-actions', {
        ttl: 30_000,
      })
      if (isStale(gen)) return
      setSummary(data.emailSummary ?? EMPTY_SUMMARY)
    } catch {
      if (isStale(gen)) return
      setError(true)
    } finally {
      if (!isStale(gen)) setLoading(false)
    }
  }, [begin, isStale])

  useEffect(() => {
    if (hasFetchedRef.current) return
    hasFetchedRef.current = true
    void fetchSummary()
  }, [fetchSummary])

  useOrgChanged(
    useCallback(() => {
      invalidate()
      hasFetchedRef.current = false
      setLoading(true)
      void fetchSummary()
    }, [fetchSummary, invalidate]),
  )

  if (loading) {
    return (
      <div className="surface-card p-5" aria-busy="true">
        <Skeleton h={14} w="45%" />
        <div className="mt-3 space-y-2">
          <Skeleton h={12} w="80%" />
          <Skeleton h={12} w="65%" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="surface-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-fg/5 rounded-md shrink-0">
              <EnvelopeIcon className="h-4 w-4 text-fg-muted" aria-hidden="true" />
            </div>
            <h3 className="text-xs uppercase tracking-wider font-medium text-fg-muted">
              {t('dashboard.email.title')}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => {
              setLoading(true)
              void fetchSummary()
            }}
            className="focus-ring text-accent hover:text-accent-hover"
            aria-label={t('common.retry')}
          >
            <ArrowPathIcon className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-3 text-sm text-fg-muted">{t('dashboard.email.loadError')}</p>
      </div>
    )
  }

  const { failedLast7Days, lastSentAt, pendingScheduled } = summary

  return (
    <div className="surface-card p-5 hover:bg-fg/[0.02] transition-colors">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs uppercase tracking-wider font-medium text-fg-muted">
          {t('dashboard.email.title')}
        </p>
        <div className="p-1.5 bg-fg/5 rounded-md shrink-0">
          <EnvelopeIcon className="h-4 w-4 text-fg-muted" aria-hidden="true" />
        </div>
      </div>
      <div className="space-y-2 text-sm">
        {failedLast7Days > 0 ? (
          <Link
            href="/communications?tab=log"
            className="text-danger hover:underline focus-ring rounded font-medium"
          >
            {t('dashboard.email.failedLast7Days').replace('{count}', String(failedLast7Days))}
          </Link>
        ) : (
          <p className="text-fg-muted">{t('dashboard.email.failedLast7DaysNone')}</p>
        )}
        <p className="text-fg-muted">
          {lastSentAt
            ? t('dashboard.email.lastSent').replace('{time}', formatRelative(lastSentAt))
            : t('dashboard.email.lastSentNever')}
        </p>
        {pendingScheduled > 0 && (
          <p className="text-fg font-medium">
            {t('dashboard.email.pendingScheduled').replace('{count}', String(pendingScheduled))}
          </p>
        )}
      </div>
      <Link
        href="/communications?tab=log"
        className="mt-3 inline-block text-xs font-medium text-accent hover:text-accent-hover hover:underline focus-ring rounded"
      >
        {t('dashboard.email.viewLog')}
      </Link>
    </div>
  )
}
