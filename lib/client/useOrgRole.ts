'use client'



/**

 * Resolves the user's role in the active organization. Uses the same

 * `/api/organizations` payload as OrgSwitcher and refreshes on org switch.

 */



import { useCallback, useEffect, useRef, useState } from 'react'

import { cachedFetch, invalidate as invalidateCache } from '@/lib/client-cache'

import type { Role } from '@/lib/auth-helpers'



const URL = '/api/organizations'

const ORG_CHANGED = 'kasa:org-changed'



function isAdminRole(role: Role | null): boolean {

  return role === 'admin' || role === 'owner'

}



export function useOrgRole(): {

  role: Role | null

  loading: boolean

  isAdmin: boolean

} {

  const [role, setRole] = useState<Role | null>(null)

  const [loading, setLoading] = useState(true)

  const refreshIdRef = useRef(0)



  const refresh = useCallback(async () => {

    const id = ++refreshIdRef.current

    setLoading(true)

    try {

      const data = await cachedFetch<{

        organizations?: { id: string; role: string }[]

        activeOrgId?: string | null

      }>(URL, { ttl: 60_000 })

      if (id !== refreshIdRef.current) return

      const activeId = data.activeOrgId ?? data.organizations?.[0]?.id

      const active = data.organizations?.find((o) => o.id === activeId)

      setRole((active?.role as Role) ?? null)

    } catch {

      if (id === refreshIdRef.current) setRole(null)

    } finally {

      if (id === refreshIdRef.current) setLoading(false)

    }

  }, [])



  useEffect(() => {

    void refresh()

    const onOrgChanged = () => {

      invalidateCache(URL)

      void refresh()

    }

    window.addEventListener(ORG_CHANGED, onOrgChanged)

    return () => window.removeEventListener(ORG_CHANGED, onOrgChanged)

  }, [refresh])



  return {

    role,

    loading,

    isAdmin: isAdminRole(role),

  }

}


