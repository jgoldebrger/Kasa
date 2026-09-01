/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  usePathname: () => '/payments',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

vi.mock('@/lib/client/OrgRoleContext', () => ({
  useOrgRole: () => ({ role: 'admin', isAdmin: true, loading: false }),
}))

vi.mock('@/lib/client/i18n', () => ({
  useT: () => (key: string) => key,
}))

// Sidebar calls useOrgBranding() unconditionally (no provider in this test),
// and useSession()/signOut() directly — mock both so the component can mount
// without a real auth/branding provider tree.
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
  signOut: vi.fn(),
}))

vi.mock('@/lib/client/useOrgBranding', () => ({
  useOrgBranding: () => ({
    branding: { name: 'Kasa', slug: null, logoDataUrl: null, logoUrl: null, accentColor: null },
    loading: false,
    refresh: vi.fn(),
  }),
}))

describe('Sidebar a11y', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('starts nav sections collapsed and toggles aria-expanded', async () => {
    const Sidebar = (await import('./Sidebar')).default
    render(<Sidebar />)
    const moneyToggle = screen.getByRole('button', { name: /nav.section.money/i })
    expect(moneyToggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(moneyToggle)
    expect(moneyToggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(moneyToggle)
    expect(moneyToggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('marks the active nav item with aria-current for the matched route', async () => {
    const Sidebar = (await import('./Sidebar')).default
    render(<Sidebar />)
    fireEvent.click(screen.getByRole('button', { name: /nav.section.money/i }))
    const paymentsLink = screen.getByRole('link', { name: /^nav.payments$/i })
    expect(paymentsLink.getAttribute('aria-current')).toBe('page')
  })

  it('omits the settings tab query for the email default deep link', async () => {
    const Sidebar = (await import('./Sidebar')).default
    render(<Sidebar />)
    fireEvent.click(screen.getByRole('button', { name: /nav.section.settings/i }))
    const emailLink = screen.getByRole('link', { name: /^settings\.email$/i })
    expect(emailLink.getAttribute('href')).toBe('/settings')

    const membersLink = screen.getByRole('link', { name: /^settings\.nav\.members$/i })
    expect(membersLink.getAttribute('href')).toBe('/settings?tab=members')
  })

  it('hides admin-only sections for member role', async () => {
    vi.resetModules()
    vi.doMock('@/lib/client/OrgRoleContext', () => ({
      useOrgRole: () => ({ role: 'member', isAdmin: false, loading: false }),
    }))
    const Sidebar = (await import('./Sidebar')).default
    render(<Sidebar />)
    expect(screen.queryByRole('button', { name: /nav.section.money/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /nav.section.overview/i }))
    expect(screen.getByRole('link', { name: /^nav.dashboard$/i })).toBeDefined()
  })
})
