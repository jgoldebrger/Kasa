/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Select } from './Select'

describe('Select a11y', () => {
  it('only references the rendered error when error replaces hint', () => {
    render(
      <Select label="Account" hint="Choose an account" error="Required">
        <option value="">Select an account</option>
      </Select>,
    )

    const field = screen.getByLabelText('Account')
    const alert = screen.getByRole('alert')
    const describedBy = field.getAttribute('aria-describedby')
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(describedBy).toBe(alert.id)
    expect(document.getElementById(describedBy || '')).toBe(alert)
    expect(alert.textContent).toContain('Required')
    expect(screen.queryByText('Choose an account')).toBeNull()
  })

  it('uses aria-label as its accessible name without a label prop', () => {
    render(
      <Select aria-label="Account type">
        <option>Checking</option>
      </Select>,
    )

    expect(screen.getByRole('combobox', { name: 'Account type' })).toBeDefined()
  })

  it('uses aria-labelledby as its accessible name without a label prop', () => {
    render(
      <>
        <span id="account-label">Funding account</span>
        <Select aria-labelledby="account-label">
          <option>Checking</option>
        </Select>
      </>,
    )

    expect(screen.getByRole('combobox', { name: 'Funding account' })).toBeDefined()
  })
})
