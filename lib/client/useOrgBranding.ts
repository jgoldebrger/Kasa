'use client'

/**
 * useOrgBranding — fetches the active org's branding (logo + accent color)
 * once per session and caches it via `client-cache`. Listens for a custom
 * `branding-updated` window event so the sidebar refreshes the instant the
 * settings page saves a new logo.
 */

import { useCallback, useEffect, useState } from 'react'
import { cachedFetch, invalidate as invalidateCache } from '@/lib/client-cache'
import { useRequestGeneration } from '@/lib/client/useRequestGeneration'

const URL = '/api/organizations/branding'
const TTL_MS = 5 * 60 * 1000 // 5 min — branding rarely changes
const EVENT = 'kasa:branding-updated'
const ORG_CHANGED = 'kasa:org-changed'

export interface OrgBranding {
  name: string | null
  slug: string | null
  /** Inline data URL — preserved for backward compatibility. Prefer `logoUrl`. */
  logoDataUrl: string | null
  /**
   * Versioned binary endpoint URL. Browsers cache this forever (immutable
   * + version-bump on update), so repeated page loads don't reship the
   * ~200KB data URL inline.
   */
  logoUrl: string | null
  accentColor: string | null
}

const EMPTY: OrgBranding = {
  name: null,
  slug: null,
  logoDataUrl: null,
  logoUrl: null,
  accentColor: null,
}

export function useOrgBranding(): {
  branding: OrgBranding
  loading: boolean
  refresh: () => Promise<void>
} {
  const [branding, setBranding] = useState<OrgBranding>(EMPTY)
  const [loading, setLoading] = useState(true)
  const { begin, invalidate, isStale } = useRequestGeneration()

  const refresh = useCallback(async () => {
    const gen = begin()
    try {
      setLoading(true)
      const data = await cachedFetch<{
        name?: string
        slug?: string
        branding?: {
          logoDataUrl?: string | null
          logoUrl?: string | null
          accentColor?: string | null
        }
      }>(URL, { ttl: TTL_MS })
      if (isStale(gen)) return
      setBranding({
        name: data?.name || null,
        slug: data?.slug || null,
        logoDataUrl: data?.branding?.logoDataUrl || null,
        logoUrl: data?.branding?.logoUrl || null,
        accentColor: data?.branding?.accentColor || null,
      })
    } catch {
      if (isStale(gen)) return
      setBranding(EMPTY)
    } finally {
      if (!isStale(gen)) setLoading(false)
    }
  }, [begin, isStale])

  useEffect(() => {
    void refresh()
    const onBrandingUpdated = () => {
      invalidateCache(URL)
      invalidate()
      void refresh()
    }
    const onOrgChanged = () => {
      invalidateCache(URL)
      invalidate()
      setBranding(EMPTY)
      void refresh()
    }
    window.addEventListener(EVENT, onBrandingUpdated)
    window.addEventListener(ORG_CHANGED, onOrgChanged)
    return () => {
      window.removeEventListener(EVENT, onBrandingUpdated)
      window.removeEventListener(ORG_CHANGED, onOrgChanged)
    }
  }, [refresh, invalidate])

  return { branding, loading, refresh }
}

/**
 * Fire from the Settings page after a successful logo save so every consumer
 * of `useOrgBranding` re-fetches and shows the new logo without a page reload.
 */
export function notifyBrandingUpdated() {
  invalidateCache(URL)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT))
  }
}
