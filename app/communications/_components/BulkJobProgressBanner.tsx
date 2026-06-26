'use client'

import { ArrowPathIcon } from '@heroicons/react/24/outline'
import { Alert } from '@/app/components/ui'
import { useT } from '@/lib/client/i18n'
import type { BulkJobStatus } from './useBulkJobPoll'

interface BulkJobProgressBannerProps {
  status: BulkJobStatus
  polling: boolean
}

export default function BulkJobProgressBanner({ status, polling }: BulkJobProgressBannerProps) {
  const t = useT()

  const total = status.totalFamilies || status.processed + status.remaining
  const progress =
    total > 0 ? Math.min(100, Math.round((status.processed / total) * 100)) : undefined

  const variant = status.done ? (status.failed > 0 ? 'warning' : 'success') : 'info'

  const title = status.done
    ? t('communications.job.doneTitle')
        .replace('{sent}', String(status.sent))
        .replace('{failed}', String(status.failed))
    : t('communications.job.sendingTitle').replace(
        '{progress}',
        total > 0 ? `${status.processed}/${total}` : String(status.processed),
      )

  return (
    <Alert variant={variant} title={title}>
      {polling && !status.done && (
        <div className="mt-2 space-y-2">
          {progress != null && (
            <div className="h-2 w-full rounded-full bg-app-subtle overflow-hidden">
              <div
                className="h-full bg-accent transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
          <p className="flex items-center gap-2 text-xs">
            <ArrowPathIcon className="h-4 w-4 animate-spin shrink-0" />
            {t('communications.job.sendingHint')}
          </p>
        </div>
      )}
      {status.done && status.errors.length > 0 && (
        <ul className="mt-2 list-disc list-inside text-xs space-y-0.5">
          {status.errors.slice(0, 5).map((err, i) => (
            <li key={i}>{err}</li>
          ))}
          {status.errors.length > 5 && (
            <li>
              {t('communications.job.moreErrors').replace(
                '{count}',
                String(status.errors.length - 5),
              )}
            </li>
          )}
        </ul>
      )}
      {status.lastError && !status.done && (
        <p className="mt-1 text-xs text-danger">{status.lastError}</p>
      )}
    </Alert>
  )
}
