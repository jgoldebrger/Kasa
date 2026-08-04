/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AppShell from './AppShell'

const navigation = vi.hoisted(() => ({ pathname: '/payments' }))

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
}))

vi.mock('@/lib/client/i18n', () => ({
  useT: () => (key: string) => `translated:${key}`,
}))

vi.mock('@/lib/client/support-mode', () => ({
  fetchSupportModeStatus: () => Promise.resolve({ active: false }),
  useSupportModeChanged: vi.fn(),
}))

vi.mock('./MobileTopBar', () => ({
  default: ({ onOpenMenu, menuOpen }: { onOpenMenu: () => void; menuOpen: boolean }) => (
    <button id="mobile-nav-trigger" type="button" aria-expanded={menuOpen} onClick={onOpenMenu}>
      Open menu
    </button>
  ),
}))

vi.mock('./Sidebar', () => ({
  default: ({ onClose }: { onClose?: () => void }) => (
    <button type="button" onClick={onClose}>
      Close menu
    </button>
  ),
}))

vi.mock('./PlatformImpersonationBanner', () => ({ default: () => null }))
vi.mock('./SupportSessionSummaryHost', () => ({ default: () => null }))
vi.mock('./OfflineSyncIndicator', () => ({ default: () => null }))
vi.mock('./OfflineQueueSyncHost', () => ({ default: () => null }))
vi.mock('./KeyboardShortcuts', () => ({ default: () => null }))
vi.mock('./GlobalQuickActionModals', () => ({ default: () => null }))

describe('AppShell smoke', () => {
  afterEach(() => {
    cleanup()
    navigation.pathname = '/payments'
  })

  it('uses the translated skip-link label on application routes', () => {
    render(<AppShell>Page content</AppShell>)

    const skipLink = screen.getByRole('link', { name: 'translated:nav.skipToContent' })
    expect(skipLink.getAttribute('href')).toBe('#main-content')
  })

  it('bypasses application chrome on fullscreen routes', () => {
    navigation.pathname = '/login'

    render(<AppShell>Sign in</AppShell>)

    expect(screen.getByText('Sign in')).toBeDefined()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open menu' })).toBeNull()
  })

  it('returns focus to the mobile navigation trigger after Escape closes the drawer', () => {
    render(<AppShell>Page content</AppShell>)
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Close menu' }).focus()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open menu' }))
  })
})
