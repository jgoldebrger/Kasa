/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import FilterChips from './FilterChips'

describe('FilterChips a11y', () => {
  it('names clear controls and uses logical auto margin', () => {
    const { container } = render(
      <FilterChips
        filters={[
          {
            id: 'status',
            label: 'Status',
            display: 'Active',
            clear: vi.fn(),
          },
        ]}
        onClearAll={vi.fn()}
        summary="1 result"
      />,
    )

    expect(screen.getByRole('button', { name: 'Clear Status filter' })).toBeTruthy()
    expect(container.innerHTML).toMatch(/ms-auto/)
    expect(container.innerHTML).not.toMatch(/\bml-auto\b/)
  })
})
