/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Textarea } from './Textarea'

describe('Textarea a11y', () => {
  it('associates label, hint, and error', () => {
    render(<Textarea label="Notes" hint="Add context" error="Required" />)

    const field = screen.getByLabelText('Notes')
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(field.getAttribute('aria-describedby') || '').toMatch(/hint/)
    expect(field.getAttribute('aria-describedby') || '').toMatch(/err/)
    expect(screen.getByRole('alert').textContent).toContain('Required')
  })
})
