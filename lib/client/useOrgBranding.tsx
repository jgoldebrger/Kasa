'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { cachedFetch, invalidate as invalidateCache } from '@/lib/client-cache'
import { useRequestGeneration } from '@/lib/client/useRequestGeneration'
import { applyAccentCssVars, clearAccentCssVars } from '@/lib/branding-colors'

const URL = '/api/organizations/branding'
const TTL_MS = 5 * 60 * 1000
const EVENT = 'kasa:branding-updated'
const ORG_CHANGED = 'kasa:org-changed'

export interface OrgBranding {
  name: string | null
  slug: string | null
  logoDataUrl: string | null
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

interface BrandingContextValue {
  branding: OrgBranding
  loading: boolean
  refresh: () => Promise<void>
}

const BrandingCtx = createContext<BrandingContextValue | null>(null)

export interface OrgBrandingProviderProps {
  children: React.ReactNode
  initialBranding?: OrgBranding
}

export function OrgBrandingProvider({ children, initialBranding }: OrgBrandingProviderProps) {
  const { status: sessionStatus } = useSession()
  const serverSeeded = initialBranding !== undefined
  const [branding, setBranding] = useState<OrgBranding>(initialBranding ?? EMPTY)
  const [loading, setLoading] = useState(!serverSeeded)
  const { begin, invalidate, isStale } = useRequestGeneration()
  const seededRef = useRef(serverSeeded)

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
      if (!seededRef.current) setBranding(EMPTY)
    } finally {
      if (!isStale(gen)) setLoading(false)
    }
  }, [begin, isStale])

  useEffect(() => {
    if (sessionStatus === 'loading') return
    if (sessionStatus !== 'authenticated') {
      if (!serverSeeded) setBranding(EMPTY)
      setLoading(false)
      return
    }
    if (!serverSeeded) {
      void refresh()
    }

    const onBrandingUpdated = () => {
      invalidateCache(URL)
      invalidate()
      void refresh()
    }
    const onOrgChanged = () => {
      invalidateCache(URL)
      invalidate()
      seededRef.current = false
      setBranding(EMPTY)
      void refresh()
    }
    window.addEventListener(EVENT, onBrandingUpdated)
    window.addEventListener(ORG_CHANGED, onOrgChanged)
    return () => {
      window.removeEventListener(EVENT, onBrandingUpdated)
      window.removeEventListener(ORG_CHANGED, onOrgChanged)
    }
  }, [refresh, invalidate, serverSeeded, sessionStatus])

  useEffect(() => {
    const root = document.documentElement

    function syncAccentVars() {
      if (!branding.accentColor) {
        clearAccentCssVars(root)
        return
      }
      const isDark = root.classList.contains('dark')
      applyAccentCssVars(branding.accentColor, isDark, root)
    }

    syncAccentVars()

    const observer = new MutationObserver(syncAccentVars)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })

    return () => {
      observer.disconnect()
      clearAccentCssVars(root)
    }
  }, [branding.accentColor])

  return (
    <BrandingCtx.Provider value={{ branding, loading, refresh }}>{children}</BrandingCtx.Provider>
  )
}

export function useOrgBranding(): BrandingContextValue {
  const ctx = useContext(BrandingCtx)
  if (!ctx) {
    throw new Error('useOrgBranding must be used within OrgBrandingProvider')
  }
  return ctx
}

export function notifyBrandingUpdated() {
  invalidateCache(URL)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT))
  }
}
