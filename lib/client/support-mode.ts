'use client'

import { useCallback, useEffect, useState } from 'react'
import { clearCache } from '@/lib/client-cache'

export const SUPPORT_MODE_CHANGED = 'kasa:support-mode-changed'
const ORG_CHANGED = 'kasa:org-changed'

export type SupportModeDetail = {
  active: boolean
  organizationName?: string | null
  organizationSlug?: string | null
  organizationId?: string | null
  readOnly?: boolean
  expiresAt?: number | null // unix seconds
}

/** Tell client UI (banner, admin hub) that support mode started or ended. */
export function notifySupportModeChanged(detail: SupportModeDetail): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(SUPPORT_MODE_CHANGED, { detail }))
}

function clearOrgCaches(): void {
  clearCache()
  if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_ORG_CACHES' })
  }
}

function dispatchOrgChanged(orgId?: string): void {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent(ORG_CHANGED, { detail: orgId ? { orgId } : {} }))
  } catch {
    // CustomEvent is in every modern browser we ship to.
  }
}

/** After successful POST impersonate — call from UI once the API returns ok. */
export async function enterSupportMode(opts: {
  organizationId: string
  organizationName: string
  organizationSlug?: string | null
  readOnly?: boolean
  expiresAt?: number | null
  redirectTo?: string
  router: { push: (url: string) => void; refresh: () => void }
  updateSession?: () => Promise<unknown>
}): Promise<void> {
  notifySupportModeChanged({
    active: true,
    organizationId: opts.organizationId,
    organizationName: opts.organizationName,
    organizationSlug: opts.organizationSlug ?? null,
    readOnly: opts.readOnly,
    expiresAt: opts.expiresAt ?? null,
  })
  clearOrgCaches()
  try {
    await opts.updateSession?.()
  } catch {
    // updateSession can throw if the user is signed out; tolerate it.
  }
  dispatchOrgChanged(opts.organizationId)
  opts.router.push(opts.redirectTo ?? '/')
  opts.router.refresh()
}

export type SupportSessionAction = {
  action: string
  at: string
}

export type ExitSupportModeResult =
  | { ok: true; actions: SupportSessionAction[] }
  | { ok: false; error: string }

/** After successful DELETE or local exit — ends support mode server-side. */
export async function exitSupportMode(opts: {
  router: { push: (url: string) => void; refresh: () => void }
  updateSession?: () => Promise<unknown>
  redirectTo?: string
}): Promise<ExitSupportModeResult> {
  try {
    const res = await fetch('/api/admin/impersonate', { method: 'DELETE' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, error: body?.error || 'Could not exit support mode' }
    }

    const actions: SupportSessionAction[] = Array.isArray(body.actions)
      ? body.actions
          .filter(
            (row: unknown): row is SupportSessionAction =>
              !!row &&
              typeof row === 'object' &&
              typeof (row as SupportSessionAction).action === 'string' &&
              typeof (row as SupportSessionAction).at === 'string',
          )
          .slice(0, 50)
      : []

    notifySupportModeChanged({ active: false })
    clearOrgCaches()
    try {
      await opts.updateSession?.()
    } catch {
      // tolerate signed-out session during exit
    }
    dispatchOrgChanged()
    opts.router.push(opts.redirectTo ?? '/admin')
    opts.router.refresh()
    return { ok: true, actions }
  } catch {
    return { ok: false, error: 'Network error exiting support mode' }
  }
}

/** React to support-mode start/end events (banner, admin hub). */
export function useSupportModeChanged(onChange: (detail: SupportModeDetail) => void): void {
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<SupportModeDetail>).detail
      onChange(detail)
    }
    window.addEventListener(SUPPORT_MODE_CHANGED, handler)
    return () => window.removeEventListener(SUPPORT_MODE_CHANGED, handler)
  }, [onChange])
}

/** Client hook for read-only platform support impersonation. */
export function useSupportModeReadOnly(): {
  active: boolean
  readOnly: boolean
  loading: boolean
} {
  const [state, setState] = useState<SupportModeDetail>({ active: false })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void fetchSupportModeStatus().then((detail) => {
      if (!cancelled) {
        setState(detail)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  useSupportModeChanged(
    useCallback((detail) => {
      setState(detail)
      setLoading(false)
    }, []),
  )

  return {
    active: Boolean(state.active),
    readOnly: Boolean(state.active && state.readOnly),
    loading,
  }
}

export async function fetchSupportModeStatus(): Promise<SupportModeDetail> {
  try {
    const res = await fetch('/api/admin/impersonate')
    if (res.status === 403 || res.status === 401 || !res.ok) {
      return { active: false }
    }
    const data = await res.json()
    return {
      active: Boolean(data.active),
      organizationId: data.organizationId ?? null,
      organizationName: data.organizationName ?? null,
      organizationSlug: data.organizationSlug ?? null,
      readOnly: Boolean(data.readOnly),
      expiresAt: data.expiresAt ?? null,
    }
  } catch {
    return { active: false }
  }
}
