/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import PrivacyPolicyPage from '../privacy/page'
import TermsOfServicePage from '../terms/page'
import SubprocessorsPage from '../subprocessors/page'

describe('legal pages smoke', () => {
  it('renders Privacy Policy', () => {
    render(<PrivacyPolicyPage />)
    expect(screen.getByRole('heading', { level: 1, name: /privacy policy/i })).toBeDefined()
    expect(screen.getAllByText(/lawful bases/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/authjs\.session-token/i).length).toBeGreaterThan(0)
  })

  it('renders Terms of Service', () => {
    render(<TermsOfServicePage />)
    expect(screen.getByRole('heading', { level: 1, name: /terms of service/i })).toBeDefined()
    expect(screen.getByText(/acceptable use/i)).toBeDefined()
  })

  it('renders Subprocessors', () => {
    render(<SubprocessorsPage />)
    expect(screen.getByRole('heading', { level: 1, name: /subprocessors/i })).toBeDefined()
    expect(screen.getByRole('table')).toBeDefined()
    expect(screen.getByText(/MongoDB Atlas/i)).toBeDefined()
  })
})
