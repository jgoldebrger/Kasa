/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Alert } from './Alert'

describe('Alert accessibility', () => {
  it('uses an alert role for danger feedback', () => {
    const { container } = render(<Alert variant="danger" title="Failed" />)
    const alert = container.firstElementChild

    expect(alert?.getAttribute('role')).toBe('alert')
    expect(alert?.textContent).toContain('Failed')
  })

  it('uses a status role for non-danger feedback', () => {
    const { container } = render(<Alert title="Saved" />)
    const alert = container.firstElementChild

    expect(alert?.getAttribute('role')).toBe('status')
    expect(alert?.textContent).toContain('Saved')
  })

  it('honors an explicit role override', () => {
    const { container } = render(<Alert variant="danger" role="status" title="Retry available" />)
    const alert = container.firstElementChild

    expect(alert?.getAttribute('role')).toBe('status')
    expect(alert?.textContent).toContain('Retry available')
  })
})
