'use client'

import { useCallback, useState } from 'react'
import type { SupportModeRedirect } from '@/lib/support-mode-redirect'
import type { SupportModeScope } from '@/lib/support-mode-scope'
import {
  isPlatformAdminTotpReverifyError,
  needsPlatformAdminTotpForWrite,
} from '@/lib/client/platform-admin-totp'

export type PendingSupportModeEntry = {
  orgId: string
  reason: string
  readOnly: boolean
  scope: SupportModeScope
  redirectTo: SupportModeRedirect
}

type ImpersonateResponse = {
  organizationId?: string
  organizationName?: string
  organizationSlug?: string | null
  readOnly?: boolean
  scope?: SupportModeScope
  expiresAt?: number | null
  redirectTo?: SupportModeRedirect
  error?: string
  code?: string
}

export function usePlatformAdminTotpGate() {
  const [totpOpen, setTotpOpen] = useState(false)
  const [pending, setPending] = useState<PendingSupportModeEntry | null>(null)

  const clearPending = useCallback(() => {
    setPending(null)
    setTotpOpen(false)
  }, [])

  async function runWithTotpGate(
    entry: PendingSupportModeEntry,
    action: (entry: PendingSupportModeEntry) => Promise<Response>,
  ): Promise<{ ok: true; data: ImpersonateResponse } | { ok: false; error: string }> {
    if (!entry.readOnly) {
      const needsTotp = await needsPlatformAdminTotpForWrite()
      if (needsTotp) {
        setPending(entry)
        setTotpOpen(true)
        return { ok: false, error: '' }
      }
    }

    const res = await action(entry)
    const data = (await res.json().catch(() => ({}))) as ImpersonateResponse
    if (!res.ok) {
      if (!entry.readOnly && isPlatformAdminTotpReverifyError(data)) {
        setPending(entry)
        setTotpOpen(true)
        return { ok: false, error: '' }
      }
      return { ok: false, error: data.error || 'Request failed.' }
    }
    return { ok: true, data }
  }

  async function retryAfterTotpVerified(
    action: (entry: PendingSupportModeEntry) => Promise<Response>,
  ): Promise<{ ok: true; data: ImpersonateResponse } | { ok: false; error: string }> {
    if (!pending) return { ok: false, error: 'No pending action.' }
    const entry = pending
    setTotpOpen(false)
    const res = await action(entry)
    const data = (await res.json().catch(() => ({}))) as ImpersonateResponse
    setPending(null)
    if (!res.ok) {
      return { ok: false, error: data.error || 'Request failed.' }
    }
    return { ok: true, data }
  }

  return {
    totpOpen,
    setTotpOpen,
    pending,
    clearPending,
    runWithTotpGate,
    retryAfterTotpVerified,
  }
}
