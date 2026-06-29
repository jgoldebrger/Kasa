'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Sidebar from './Sidebar'
import MobileTopBar from './MobileTopBar'
import PlatformImpersonationBanner from './PlatformImpersonationBanner'
import SupportSessionSummaryHost from './SupportSessionSummaryHost'
import OfflineSyncIndicator from './OfflineSyncIndicator'
import OfflineQueueSyncHost from './OfflineQueueSyncHost'
import KeyboardShortcuts from './KeyboardShortcuts'
import GlobalQuickActionModals from './GlobalQuickActionModals'
import {
  fetchSupportModeStatus,
  useSupportModeChanged,
  type SupportModeDetail,
} from '@/lib/client/support-mode'

const FULLSCREEN_PATHS = [
  '/welcome',
  '/login',
  '/signup',
  '/invite',
  '/reset-password',
  '/request-invite',
  '/setup',
  '/privacy',
  '/terms',
  '/subprocessors',
  '/pricing',
]

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || ''
  const isFullscreen = FULLSCREEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))

  const [menuOpen, setMenuOpen] = useState(false)
  const [supportMode, setSupportMode] = useState<SupportModeDetail>({ active: false })

  useSupportModeChanged(
    useCallback((detail) => {
      setSupportMode(detail)
    }, []),
  )

  useEffect(() => {
    void fetchSupportModeStatus().then(setSupportMode)
  }, [pathname])

  // Auto-close the mobile drawer when the route changes (the Sidebar
  // also calls onClose on link click; this is a belt-and-braces in case
  // navigation happens via back-button or programmatic push).
  useEffect(() => {
    setMenuOpen(false)
  }, [pathname])

  // Close on Escape — Modal handles its own, but the drawer needs its own listener.
  useEffect(() => {
    if (!menuOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [menuOpen])

  if (isFullscreen) {
    return <>{children}</>
  }

  return (
    <>
      {/* Skip-to-content link — first focusable element in the page. */}
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      {/* Mobile top bar (hidden on md+). */}
      <MobileTopBar onOpenMenu={() => setMenuOpen(true)} menuOpen={menuOpen} />

      {/* Desktop sidebar: always visible from md up. Uses logical
          `start-0` so RTL locales (he-IL, yi) automatically pin it to
          the right edge instead of needing a parallel `right-0` class. */}
      <div
        id="primary-sidebar-desktop"
        className="fixed inset-y-0 start-0 z-40 hidden w-64 min-w-0 overflow-x-hidden md:block"
      >
        <Sidebar />
      </div>

      {/* Mobile drawer: backdrop + slide-in sidebar. */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/40 animate-ui-fade"
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />
          <div
            id="primary-sidebar"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className="relative h-full w-72 max-w-[85vw] animate-ui-slide shadow-2xl"
          >
            <Sidebar onClose={() => setMenuOpen(false)} />
          </div>
        </div>
      )}

      {/* Main column: banner sits outside scrollable content so sticky works on mobile. */}
      <div className="min-h-screen md:ms-64 flex flex-col">
        <PlatformImpersonationBanner />
        <OfflineSyncIndicator />
        <SupportSessionSummaryHost />
        <OfflineQueueSyncHost />
        <main
          id="main-content"
          className="flex-1 min-h-0"
          data-support-mode={supportMode.active ? 'true' : undefined}
          data-support-mode-readonly={supportMode.readOnly ? 'true' : undefined}
        >
          {children}
        </main>
      </div>
      <KeyboardShortcuts />
      <GlobalQuickActionModals />
    </>
  )
}
