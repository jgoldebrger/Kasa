'use client'

import { useEffect, useState } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import { Modal, Button, SkeletonRows } from '@/app/components/ui'
import { useToast } from '@/app/components/Toast'
import { useT } from '@/lib/client/i18n'
import type { MessageKey } from '@/lib/i18n/load-locale'
import type { CampaignStats } from './types'

interface CampaignStatsModalProps {
  open: boolean
  campaignId: string | null
  onClose: () => void
  onRetrySuccess?: () => void
}

function resolveRates(stats: CampaignStats) {
  const sent = stats.sent ?? 0
  const openRate = stats.openRate ?? (sent > 0 ? stats.opened / sent : 0)
  const clickRate = stats.clickRate ?? (sent > 0 ? stats.clicked / sent : 0)
  return { openRate, clickRate }
}

export default function CampaignStatsModal({
  open,
  campaignId,
  onClose,
  onRetrySuccess,
}: CampaignStatsModalProps) {
  const t = useT()
  const toast = useToast()
  const [stats, setStats] = useState<CampaignStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    if (!open || !campaignId) {
      setStats(null)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const res = await fetch(`/api/emails/campaign/${campaignId}`)
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Failed to load stats')
        if (!cancelled) setStats((data.data ?? data) as CampaignStats)
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('communications.campaign.error'))
          setStats(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, campaignId, t])

  const formatRate = (rate: number) => `${Math.round(rate * 100)}%`
  const rates = stats ? resolveRates(stats) : null
  const topLinks = stats?.topLinks ?? []
  const failedCount = stats?.failed ?? 0

  const retryFailed = async () => {
    if (!campaignId) return
    setRetrying(true)
    try {
      const res = await fetch('/api/emails/retry-failed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Retry failed')
      const retried = data.retried ?? data.sent ?? 0
      toast.success(t('communications.retry.success').replace('{count}', String(retried)))
      onRetrySuccess?.()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('communications.retry.error'))
    } finally {
      setRetrying(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('communications.campaign.title')}
      description={t('communications.campaign.description')}
      footer={
        <div className="flex flex-wrap gap-2 justify-end w-full">
          {failedCount > 0 && campaignId && (
            <Button
              type="button"
              variant="secondary"
              loading={retrying}
              leftIcon={<ArrowPathIcon className="h-4 w-4" />}
              onClick={() => void retryFailed()}
            >
              {t('communications.retry.button').replace('{count}', String(failedCount))}
            </Button>
          )}
          <Button type="button" variant="primary" onClick={onClose}>
            {t('communications.campaign.close')}
          </Button>
        </div>
      }
    >
      {loading ? (
        <SkeletonRows count={3} />
      ) : error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : stats && rates ? (
        <div className="space-y-6">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-fg-muted">{t('communications.campaign.sent')}</dt>
              <dd className="text-lg font-semibold tabular text-fg">{stats.sent}</dd>
            </div>
            {(stats.failed ?? 0) > 0 && (
              <div>
                <dt className="text-xs text-fg-muted">
                  {t('communications.campaign.failed' as MessageKey, 'Failed')}
                </dt>
                <dd className="text-lg font-semibold tabular text-danger">{stats.failed}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-fg-muted">{t('communications.campaign.opened')}</dt>
              <dd className="text-lg font-semibold tabular text-fg">{stats.opened}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">{t('communications.campaign.clicked')}</dt>
              <dd className="text-lg font-semibold tabular text-fg">{stats.clicked}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">{t('communications.campaign.rates')}</dt>
              <dd className="text-sm font-medium tabular text-fg">
                {formatRate(rates.openRate)} / {formatRate(rates.clickRate)}
              </dd>
            </div>
          </dl>

          {topLinks.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-fg mb-2">
                {t('communications.campaign.topLinks' as MessageKey, 'Top clicked links')}
              </h3>
              <ul className="space-y-2">
                {topLinks.map((link) => (
                  <li
                    key={link.url}
                    className="flex items-start justify-between gap-3 text-sm border border-border rounded-md px-3 py-2"
                  >
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline break-all min-w-0"
                    >
                      {link.url}
                    </a>
                    <span className="tabular text-fg-muted shrink-0">
                      {link.count ?? link.clicks ?? 0}{' '}
                      {t('communications.campaign.clicks' as MessageKey, 'clicks')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  )
}
