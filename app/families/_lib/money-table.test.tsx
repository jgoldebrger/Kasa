/** @vitest-environment happy-dom */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { moneyStatusCell } from './money-table'

describe('moneyStatusCell', () => {
  it('includes visible status text for screen readers', () => {
    const { display, srLabel } = moneyStatusCell('paid', 'Paid')
    expect(srLabel).toBe('Paid')
    render(<>{display}</>)
    expect(screen.getByText('Paid')).toBeDefined()
  })
})
