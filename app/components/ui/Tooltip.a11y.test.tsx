/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Tooltip } from './Tooltip'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Tooltip a11y', () => {
  it('makes a non-interactive trigger keyboard reachable', () => {
    render(<Tooltip content="More information">Details</Tooltip>)

    expect(screen.getByText('Details').getAttribute('tabindex')).toBe('0')
  })

  it('shows the tooltip when its trigger receives focus', () => {
    vi.useFakeTimers()
    render(
      <Tooltip content="More information" delayMs={100}>
        Details
      </Tooltip>,
    )
    const trigger = screen.getByText('Details')

    fireEvent.focus(trigger)
    act(() => vi.advanceTimersByTime(100))

    expect(screen.getByRole('tooltip').textContent).toBe('More information')
    expect(trigger.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id)
  })

  it('keeps an interactive child as the only keyboard trigger', () => {
    vi.useFakeTimers()
    render(
      <Tooltip content="More information" delayMs={100}>
        <button type="button">Details</button>
      </Tooltip>,
    )
    const trigger = screen.getByRole('button', { name: 'Details' })

    fireEvent.focus(trigger)
    act(() => vi.advanceTimersByTime(100))

    expect(trigger.parentElement?.getAttribute('tabindex')).toBeNull()
    expect(trigger.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id)
  })
})
