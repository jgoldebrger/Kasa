'use client'

import { useEffect } from 'react'
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

/** After successful DELETE or local exit — ends support mode server-side. */
export async function exitSupportMode(opts: {
  router: { push: (url: string) => void; refresh: () => void }
  updateSession?: () => Promise<unknown>
  redirectTo?: string
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/admin/impersonate', { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return { ok: false, error: body?.error || 'Could not exit support mode' }
    }

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
    return { ok: true }
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
