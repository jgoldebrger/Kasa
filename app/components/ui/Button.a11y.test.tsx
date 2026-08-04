/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from './Button'

describe('Button accessibility', () => {
  it('disables input and reports a busy state while loading', () => {
    render(<Button loading>Save</Button>)

    const button = screen.getByRole('button', { name: /save/i })
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.getAttribute('disabled')).not.toBeNull()
  })
})
