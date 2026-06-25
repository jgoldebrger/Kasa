'use client'

import { useEffect, useState } from 'react'
import { Modal, Button, SkeletonRows } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import type { CampaignStats } from './types'

interface CampaignStatsModalProps {
  open: boolean
  campaignId: string | null
  onClose: () => void
}

export default function CampaignStatsModal({ open, campaignId, onClose }: CampaignStatsModalProps) {
  const t = useT()
  const [stats, setStats] = useState<CampaignStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        if (!cancelled) setStats(data as CampaignStats)
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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('communications.campaign.title')}
      description={t('communications.campaign.description')}
      footer={
        <Button type="button" variant="primary" onClick={onClose}>
          {t('communications.campaign.close')}
        </Button>
      }
    >
      {loading ? (
        <SkeletonRows count={3} />
      ) : error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : stats ? (
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs text-fg-muted">{t('communications.campaign.sent')}</dt>
            <dd className="text-lg font-semibold tabular text-fg">{stats.sent}</dd>
          </div>
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
              {formatRate(stats.openRate)} / {formatRate(stats.clickRate)}
            </dd>
          </div>
        </dl>
      ) : null}
    </Modal>
  )
}
