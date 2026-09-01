/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Input } from './Input'

describe('Input a11y', () => {
  it('only references the rendered error when error replaces hint', () => {
    render(<Input label="Email" hint="Work email" error="Required" />)

    const field = screen.getByLabelText('Email')
    const alert = screen.getByRole('alert')
    const describedBy = field.getAttribute('aria-describedby')
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(describedBy).toBe(alert.id)
    expect(document.getElementById(describedBy || '')).toBe(alert)
    expect(alert.textContent).toContain('Required')
    expect(screen.queryByText('Work email')).toBeNull()
  })

  it('uses aria-label as its accessible name without a label prop', () => {
    render(<Input aria-label="Email address" />)

    expect(screen.getByRole('textbox', { name: 'Email address' })).toBeDefined()
  })

  it('uses aria-labelledby as its accessible name without a label prop', () => {
    render(
      <>
        <span id="email-label">Primary email</span>
        <Input aria-labelledby="email-label" />
      </>,
    )

    expect(screen.getByRole('textbox', { name: 'Primary email' })).toBeDefined()
  })

  it('uses logical padding classes for icons', () => {
    const { container } = render(<Input label="Search" leftIcon={<span data-testid="icon" />} />)

    const input = container.querySelector('input')
    expect(input?.className).toMatch(/ps-10/)
    expect(container.innerHTML).toMatch(/start-3/)
  })
})
