/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import KeyboardShortcuts from './KeyboardShortcuts'

const { pushMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

vi.mock('@/lib/client/i18n', () => ({
  useT: () => (key: string) => key,
}))

vi.mock('@/lib/client/useOrgRole', () => ({
  useOrgRole: () => ({ role: 'admin', isAdmin: true, loading: false }),
}))

// Unmount between tests so a previous render's window keydown listener
// doesn't also fire (and double-push) for the next test's assertions.
afterEach(() => {
  cleanup()
})

describe('KeyboardShortcuts smoke', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders without crashing', () => {
    const { container } = render(<KeyboardShortcuts />)
    expect(container).toBeDefined()
  })

  it('opens help modal on ? key', () => {
    render(<KeyboardShortcuts />)
    fireEvent.keyDown(window, { key: '?' })
    expect(document.body.textContent).toContain('shortcuts.title')
  })

  it('navigates with a shortcut declared in nav config', () => {
    render(<KeyboardShortcuts />)

    fireEvent.keyDown(window, { key: 'g' })
    fireEvent.keyDown(window, { key: 'c' })

    expect(pushMock).toHaveBeenCalledWith('/communications')
  })
})

describe('KeyboardShortcuts smoke — member role', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not register admin-only shortcuts for members', async () => {
    vi.resetModules()
    vi.doMock('@/lib/client/useOrgRole', () => ({
      useOrgRole: () => ({ role: 'member', isAdmin: false, loading: false }),
    }))
    const KeyboardShortcutsForMember = (await import('./KeyboardShortcuts')).default
    render(<KeyboardShortcutsForMember />)

    fireEvent.keyDown(window, { key: 'g' })
    fireEvent.keyDown(window, { key: 'c' })

    expect(pushMock).not.toHaveBeenCalled()
  })
})
