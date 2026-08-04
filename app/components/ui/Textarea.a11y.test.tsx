/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Textarea } from './Textarea'

describe('Textarea a11y', () => {
  it('only references the rendered error when error replaces hint', () => {
    render(<Textarea label="Notes" hint="Add context" error="Required" />)

    const field = screen.getByLabelText('Notes')
    const alert = screen.getByRole('alert')
    const describedBy = field.getAttribute('aria-describedby')
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(describedBy).toBe(alert.id)
    expect(document.getElementById(describedBy || '')).toBe(alert)
    expect(alert.textContent).toContain('Required')
    expect(screen.queryByText('Add context')).toBeNull()
  })

  it('uses aria-label as its accessible name without a label prop', () => {
    render(<Textarea aria-label="Additional notes" />)

    expect(screen.getByRole('textbox', { name: 'Additional notes' })).toBeDefined()
  })

  it('uses aria-labelledby as its accessible name without a label prop', () => {
    render(
      <>
        <span id="notes-label">Private notes</span>
        <Textarea aria-labelledby="notes-label" />
      </>,
    )

    expect(screen.getByRole('textbox', { name: 'Private notes' })).toBeDefined()
  })
})
