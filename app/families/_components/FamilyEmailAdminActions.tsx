'use client'

import { useState } from 'react'
import { Button } from '@/app/components/ui'
import { useToast } from '@/app/components/Toast'
import { invalidate as invalidateCache } from '@/lib/client-cache'
import { useT } from '@/lib/client/i18n'
import type { FamilyEmailStatus } from './FamilyEmailIndicators'

interface FamilyEmailAdminActionsProps {
  familyId: string
  family: FamilyEmailStatus
  onUpdated?: (patch: Partial<FamilyEmailStatus>) => void
  className?: string
}

type EmailAdminPatch = { emailDeliverabilityWarning: false } | { emailFormatInvalid: false }

export default function FamilyEmailAdminActions({
  familyId,
  family,
  onUpdated,
  className = '',
}: FamilyEmailAdminActionsProps) {
  const t = useT()
  const toast = useToast()
  const [busy, setBusy] = useState<'clearWarning' | 'clearInvalid' | null>(null)

  const hasEmail = Boolean(family.email?.trim())
  if (!hasEmail) return null

  const showClearWarning = family.emailDeliverabilityWarning === true
  const showClearInvalid = family.emailFormatInvalid === true

  if (!showClearWarning && !showClearInvalid) return null

  const patchFamily = async (body: EmailAdminPatch, action: typeof busy) => {
    setBusy(action)
    try {
      const res = await fetch(`/api/families/${familyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const updated = await res.json().catch(() => null)
      if (!res.ok) {
        const message =
          updated && typeof updated === 'object' && 'error' in updated
            ? String(updated.error)
            : t('common.error')
        toast.error(message)
        return
      }

      const patch: Partial<FamilyEmailStatus> = {}
      if ('emailDeliverabilityWarning' in body) {
        patch.emailDeliverabilityWarning = false
        toast.success(t('families.email.clearWarningSuccess'))
      }
      if ('emailFormatInvalid' in body) {
        patch.emailFormatInvalid = false
        toast.success(t('families.email.clearInvalidSuccess'))
      }

      if (updated && typeof updated === 'object' && !Array.isArray(updated)) {
        onUpdated?.({
          emailDeliverabilityWarning:
            updated.emailDeliverabilityWarning ?? patch.emailDeliverabilityWarning,
          emailFormatInvalid: updated.emailFormatInvalid ?? patch.emailFormatInvalid,
        })
      } else {
        onUpdated?.(patch)
      }
      invalidateCache(/^\/api\/families/)
    } catch {
      toast.error(t('common.networkError'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {showClearWarning && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          loading={busy === 'clearWarning'}
          disabled={busy !== null && busy !== 'clearWarning'}
          onClick={() => patchFamily({ emailDeliverabilityWarning: false }, 'clearWarning')}
        >
          {t('families.email.clearWarning')}
        </Button>
      )}
      {showClearInvalid && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          loading={busy === 'clearInvalid'}
          disabled={busy !== null && busy !== 'clearInvalid'}
          onClick={() => patchFamily({ emailFormatInvalid: false }, 'clearInvalid')}
        >
          {t('families.email.clearInvalid')}
        </Button>
      )}
    </div>
  )
}
