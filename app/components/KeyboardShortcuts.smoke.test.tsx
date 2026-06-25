/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import KeyboardShortcuts from './KeyboardShortcuts'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/lib/client/i18n', () => ({
  useT: () => (key: string) => key,
}))

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
})
