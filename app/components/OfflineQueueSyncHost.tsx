'use client'

import { useEffect, useRef } from 'react'
import { useToast } from '@/app/components/Toast'
import { useT } from '@/lib/client/i18n'
import { syncOfflineQueue } from '@/lib/client/offline-write-queue'

/**
 * Listens for reconnect and flushes the IndexedDB mutation queue.
 * Mounted once inside AppShell so every authenticated view benefits.
 */
export default function OfflineQueueSyncHost() {
  const toast = useToast()
  const t = useT()
  const syncingRef = useRef(false)

  useEffect(() => {
    const runSync = async () => {
      if (syncingRef.current) return
      syncingRef.current = true
      try {
        const result = await syncOfflineQueue({
          onConflict: () => {
            toast.error(t('offline.queue.conflict'))
          },
          onSynced: (count) => {
            if (count === 1) {
              toast.success(t('offline.queue.syncedOne'))
            } else {
              toast.success(t('offline.queue.syncedMany').replace('{count}', String(count)))
            }
          },
        })
        if (result.conflicts > 0 && result.synced === 0) {
          // Individual conflict toasts already fired; nothing extra needed.
        }
      } finally {
        syncingRef.current = false
      }
    }

    const onOnline = () => {
      void runSync()
    }

    if (navigator.onLine) {
      void runSync()
    }

    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [toast, t])

  return null
}
