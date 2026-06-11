/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import CookieNotice from './CookieNotice'
import { COOKIE_CONSENT_STORAGE_KEY } from '@/lib/legal/cookie-notice'

describe('CookieNotice', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('renders when consent has not been given', async () => {
    render(<CookieNotice />)
    expect(
      await screen.findByRole('dialog', { name: /cookies & privacy/i }),
    ).toBeDefined()
    expect(screen.getByText(/kasa_active_org/i)).toBeDefined()
  })

  it('does not render after the user accepts', async () => {
    render(<CookieNotice />)
    fireEvent.click(await screen.findByRole('button', { name: /got it/i }))
    expect(localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)).toBe('accepted')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })

  it('stays hidden on subsequent mounts after acceptance', async () => {
    localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, 'accepted')
    render(<CookieNotice />)
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })
})
