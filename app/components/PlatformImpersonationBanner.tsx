'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Badge, Button } from '@/app/components/ui'
import { useToast } from '@/app/components/Toast'
import { useT } from '@/lib/client/i18n'
import type { MessageKey } from '@/lib/i18n/load-locale'
import {
  exitSupportMode,
  fetchSupportModeStatus,
  useSupportModeChanged,
  type SupportModeDetail,
} from '@/lib/client/support-mode'
import type { SupportModeScope } from '@/lib/support-mode-scope'

function formatTimeRemaining(expiresAt: number): string {
  const nowSec = Math.floor(Date.now() / 1000)
  const remainingSec = Math.max(0, expiresAt - nowSec)
  if (remainingSec <= 0) return '0m'
  const hours = Math.floor(remainingSec / 3600)
  const minutes = Math.floor((remainingSec % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

const SCOPE_BADGE_KEYS: Record<SupportModeScope, MessageKey | null> = {
  full: null,
  communications: 'admin.supportMode.scopeBadgeCommunications',
  billing: 'admin.supportMode.scopeBadgeBilling',
}

export default function PlatformImpersonationBanner() {
  const router = useRouter()
  const pathname = usePathname()
  const toast = useToast()
  const t = useT()
  const { data: session, update: updateSession } = useSession()
  const [state, setState] = useState<SupportModeDetail | null>(null)
  const [exiting, setExiting] = useState(false)
  const [timeLabel, setTimeLabel] = useState('')
  const expiryHandledRef = useRef(false)

  const isPlatformAdmin = Boolean(session?.user?.isPlatformAdmin)

  const refresh = useCallback(async () => {
    if (!isPlatformAdmin) {
      setState({ active: false })
      return
    }
    const detail = await fetchSupportModeStatus()
    setState(detail)
  }, [isPlatformAdmin])

  useEffect(() => {
    void refresh()
  }, [refresh, pathname])

  useSupportModeChanged(
    useCallback((detail) => {
      setState(detail)
    }, []),
  )

  useEffect(() => {
    if (!state?.active || !state.expiresAt) {
      setTimeLabel('')
      expiryHandledRef.current = false
      return
    }

    const updateTimer = () => {
      const nowSec = Math.floor(Date.now() / 1000)
      if (state.expiresAt! <= nowSec) {
        setTimeLabel(t('admin.supportMode.timerExpired'))
        if (expiryHandledRef.current) return
        expiryHandledRef.current = true
        void (async () => {
          const result = await exitSupportMode({ router, updateSession, expired: true })
          if (!result.ok) {
            expiryHandledRef.current = false
            void refresh()
          }
        })()
        return
      }
      setTimeLabel(
        t('admin.supportMode.timer').replace('{time}', formatTimeRemaining(state.expiresAt!)),
      )
    }

    updateTimer()
    const id = window.setInterval(updateTimer, 60_000)
    return () => window.clearInterval(id)
  }, [state?.active, state?.expiresAt, refresh, router, t, updateSession])

  if (!isPlatformAdmin) return null

  async function handleExit() {
    setExiting(true)
    try {
      const result = await exitSupportMode({ router, updateSession })
      if (!result.ok) {
        toast.error(result.error || t('admin.supportMode.exitFailed'))
      }
    } finally {
      setExiting(false)
    }
  }

  if (!state?.active) return null

  const orgName = state.organizationName || t('admin.supportMode.defaultOrg')
  const orgSlug = state.organizationSlug
  const scopeBadgeKey = state.scope && state.scope !== 'full' ? SCOPE_BADGE_KEYS[state.scope] : null

  return (
    <div
      role="status"
      className="sticky top-0 z-30 bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 text-sm text-fg flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2 min-w-0">
        {state.readOnly && (
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
            {t('admin.supportMode.viewOnlyNotice')}
          </p>
        )}
        <p className="min-w-0">
          <strong className="font-semibold">{t('admin.supportMode.bannerTitle')}:</strong>{' '}
          {t('admin.supportMode.bannerViewing')
            .replace('{orgName}', orgName)
            .replace('{orgSlug}', orgSlug || '—')}
          {state.readOnly && (
            <Badge variant="warning" className="ms-2 align-middle">
              {t('admin.supportMode.readOnlyBadge')}
            </Badge>
          )}
          {scopeBadgeKey && (
            <Badge variant="default" className="ms-2 align-middle">
              {t(scopeBadgeKey)}
            </Badge>
          )}
        </p>
        {timeLabel && <p className="text-xs text-fg-muted">{timeLabel}</p>}
        <Link
          href="/admin"
          className="text-xs font-medium text-accent hover:text-accent-hover sm:ms-2"
        >
          {t('admin.supportMode.adminHub')}
        </Link>
      </div>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        loading={exiting}
        onClick={handleExit}
        className="shrink-0"
      >
        {t('admin.supportMode.exit')}
      </Button>
    </div>
  )
}
