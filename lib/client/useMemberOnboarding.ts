'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { cachedFetch } from '@/lib/client-cache'
import { useOrgChanged } from '@/lib/client/useOrgChanged'

const VISITED_FAMILIES_KEY = 'kasa-member-visited-families'
const VIEWED_FAMILY_KEY = 'kasa-member-viewed-family'

function storageKey(base: string, orgId: string | null): string {
  return orgId ? `${base}:${orgId}` : base
}

function readFlag(base: string, orgId: string | null): boolean {
  if (typeof window === 'undefined' || !orgId) return false
  return localStorage.getItem(storageKey(base, orgId)) === '1'
}

function writeFlag(base: string, orgId: string | null): void {
  if (typeof window === 'undefined' || !orgId) return
  localStorage.setItem(storageKey(base, orgId), '1')
}

export interface MemberOnboardingProgress {
  visitedFamilies: boolean
  viewedFamily: boolean
  loading: boolean
}

export function useMemberOnboarding(): MemberOnboardingProgress {
  const pathname = usePathname()
  const [orgId, setOrgId] = useState<string | null>(null)
  const [visitedFamilies, setVisitedFamilies] = useState(false)
  const [viewedFamily, setViewedFamily] = useState(false)
  const [loading, setLoading] = useState(true)

  const syncFromStorage = useCallback((id: string | null) => {
    setVisitedFamilies(readFlag(VISITED_FAMILIES_KEY, id))
    setViewedFamily(readFlag(VIEWED_FAMILY_KEY, id))
  }, [])

  const loadOrg = useCallback(async () => {
    try {
      const data = await cachedFetch<{
        activeOrgId?: string | null
        organizations?: { id: string }[]
      }>('/api/organizations', { ttl: 60_000 })
      const id = data.activeOrgId ?? data.organizations?.[0]?.id ?? null
      setOrgId(id)
      syncFromStorage(id)
    } catch {
      setOrgId(null)
      syncFromStorage(null)
    } finally {
      setLoading(false)
    }
  }, [syncFromStorage])

  useEffect(() => {
    void loadOrg()
  }, [loadOrg])

  useOrgChanged(
    useCallback(() => {
      setLoading(true)
      void loadOrg()
    }, [loadOrg]),
  )

  useEffect(() => {
    if (!orgId || !pathname) return

    if (pathname === '/families' || pathname.startsWith('/families?')) {
      if (!readFlag(VISITED_FAMILIES_KEY, orgId)) {
        writeFlag(VISITED_FAMILIES_KEY, orgId)
      }
      setVisitedFamilies(true)
    }

    const familyDetail = pathname.match(/^\/families\/([^/]+)/)
    if (familyDetail && familyDetail[1] !== 'new') {
      if (!readFlag(VIEWED_FAMILY_KEY, orgId)) {
        writeFlag(VIEWED_FAMILY_KEY, orgId)
      }
      setViewedFamily(true)
    }
  }, [pathname, orgId])

  return { visitedFamilies, viewedFamily, loading }
}
