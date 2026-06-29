'use client'

import { useCallback, useEffect, useState } from 'react'
import { onQueueChanged } from './events'
import { countPendingOperations } from './queue'

const ORG_CHANGED = 'kasa:org-changed'

/** Subscribe to the number of pending offline writes for the active org. */
export function useOfflineWriteQueue() {
  const [pendingCount, setPendingCount] = useState(0)
  const [online, setOnline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine)

  const refresh = useCallback(async () => {
    const count = await countPendingOperations()
    setPendingCount(count)
  }, [])

  useEffect(() => {
    void refresh()
    return onQueueChanged(() => {
      void refresh()
    })
  }, [refresh])

  useEffect(() => {
    const onOrgChanged = () => {
      void refresh()
    }
    window.addEventListener(ORG_CHANGED, onOrgChanged)
    return () => window.removeEventListener(ORG_CHANGED, onOrgChanged)
  }, [refresh])

  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  return { pendingCount, online, refresh }
}
