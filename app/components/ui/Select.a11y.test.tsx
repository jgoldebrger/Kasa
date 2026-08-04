/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Select } from './Select'

describe('Select a11y', () => {
  it('associates label, hint, and error', () => {
    render(
      <Select label="Account" hint="Choose an account" error="Required">
        <option value="">Select an account</option>
      </Select>,
    )

    const field = screen.getByLabelText('Account')
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(field.getAttribute('aria-describedby') || '').toMatch(/hint/)
    expect(field.getAttribute('aria-describedby') || '').toMatch(/err/)
    expect(screen.getByRole('alert').textContent).toContain('Required')
  })
})
