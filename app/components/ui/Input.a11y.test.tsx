/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Input } from './Input'

describe('Input a11y', () => {
  it('associates label, hint, and error', () => {
    render(<Input label="Email" hint="Work email" error="Required" />)

    const field = screen.getByLabelText('Email')
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(field.getAttribute('aria-describedby') || '').toMatch(/hint/)
    expect(field.getAttribute('aria-describedby') || '').toMatch(/err/)
    expect(screen.getByRole('alert').textContent).toContain('Required')
  })

  it('uses logical padding classes for icons', () => {
    const { container } = render(<Input label="Search" leftIcon={<span data-testid="icon" />} />)

    const input = container.querySelector('input')
    expect(input?.className).toMatch(/ps-10/)
    expect(container.innerHTML).toMatch(/start-3/)
  })
})
