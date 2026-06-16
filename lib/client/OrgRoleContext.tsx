'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { cachedFetch, invalidate as invalidateCache } from '@/lib/client-cache'
import type { Role } from '@/lib/auth-helpers'

const URL = '/api/organizations'
const ORG_CHANGED = 'kasa:org-changed'

function isAdminRole(role: Role | null): boolean {
  return role === 'admin' || role === 'owner'
}

interface OrgRoleContextValue {
  role: Role | null
  loading: boolean
  isAdmin: boolean
}

const OrgRoleContext = createContext<OrgRoleContextValue | null>(null)

export function OrgRoleProvider({
  children,
  initialRole = null,
}: {
  children: ReactNode
  initialRole?: Role | null
}) {
  const [role, setRole] = useState<Role | null>(initialRole)
  const [loading, setLoading] = useState(initialRole === null)
  const refreshIdRef = useRef(0)
  const skipInitialFetchRef = useRef(initialRole !== null)

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
    if (skipInitialFetchRef.current) {
      skipInitialFetchRef.current = false
      return
    }
    void refresh()
    const onOrgChanged = () => {
      invalidateCache(URL)
      void refresh()
    }
    window.addEventListener(ORG_CHANGED, onOrgChanged)
    return () => window.removeEventListener(ORG_CHANGED, onOrgChanged)
  }, [refresh])

  return (
    <OrgRoleContext.Provider
      value={{
        role,
        loading,
        isAdmin: isAdminRole(role),
      }}
    >
      {children}
    </OrgRoleContext.Provider>
  )
}

export function useOrgRole(): OrgRoleContextValue {
  const ctx = useContext(OrgRoleContext)
  if (ctx) return ctx
  return { role: null, loading: true, isAdmin: false }
}
