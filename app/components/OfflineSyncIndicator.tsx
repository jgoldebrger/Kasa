'use client'

import { ArrowPathIcon, CloudArrowUpIcon } from '@heroicons/react/24/outline'
import { useOfflineWriteQueue } from '@/lib/client/offline-write-queue'
import { useT } from '@/lib/client/i18n'

/**
 * Subtle banner shown while offline mutations are waiting to sync.
 */
export default function OfflineSyncIndicator() {
  const { pendingCount, online } = useOfflineWriteQueue()
  const t = useT()

  if (pendingCount === 0) return null

  const label =
    pendingCount === 1
      ? t('offline.queue.pendingSyncOne')
      : t('offline.queue.pendingSyncMany').replace('{count}', String(pendingCount))

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning"
    >
      {online ? (
        <ArrowPathIcon className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
      ) : (
        <CloudArrowUpIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
      )}
      <span>{label}</span>
    </div>
  )
}
