'use client'

import { useCallback, useEffect, useState } from 'react'
import { useToast } from '@/app/components/Toast'
import { useT } from '@/lib/client/i18n'
import {
  SUPPORT_MODE_EXIT_SUMMARY,
  type SupportModeExitSummaryDetail,
  type SupportSessionAction,
} from '@/lib/client/support-mode'
import SupportSessionSummaryModal from './SupportSessionSummaryModal'

/** Listens for support-mode exit events and shows the session summary modal or toast. */
export default function SupportSessionSummaryHost() {
  const toast = useToast()
  const t = useT()
  const [summaryActions, setSummaryActions] = useState<SupportSessionAction[]>([])
  const [summaryOpen, setSummaryOpen] = useState(false)

  const presentExitSummary = useCallback(
    (detail: SupportModeExitSummaryDetail) => {
      const { actions, expired = false } = detail
      if (actions.length > 0) {
        setSummaryActions(actions)
        setSummaryOpen(true)
        if (expired) {
          toast.info(t('admin.supportMode.sessionExpired'))
        }
        return
      }
      if (expired) {
        toast.info(t('admin.supportMode.sessionExpired'))
        return
      }
      toast.success(t('admin.supportMode.exitSuccess'))
    },
    [t, toast],
  )

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<SupportModeExitSummaryDetail>).detail
      presentExitSummary(detail)
    }
    window.addEventListener(SUPPORT_MODE_EXIT_SUMMARY, handler)
    return () => window.removeEventListener(SUPPORT_MODE_EXIT_SUMMARY, handler)
  }, [presentExitSummary])

  return (
    <SupportSessionSummaryModal
      open={summaryOpen}
      actions={summaryActions}
      onClose={() => setSummaryOpen(false)}
    />
  )
}
