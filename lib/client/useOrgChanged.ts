'use client'

import { useEffect } from 'react'
import { clearCache } from '@/lib/client-cache'

const ORG_CHANGED = 'kasa:org-changed'

/** Refetch local view state when the user switches organizations. */
export function useOrgChanged(onChange: () => void) {
  useEffect(() => {
    const handler = () => {
      clearCache()
      onChange()
    }
    window.addEventListener(ORG_CHANGED, handler)
    return () => window.removeEventListener(ORG_CHANGED, handler)
  }, [onChange])
}
