/** @vitest-environment happy-dom */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { moneyAmountCell, moneyStatusCell } from './money-table'

describe('moneyStatusCell', () => {
  it('includes visible status text for screen readers', () => {
    const { display, srLabel } = moneyStatusCell('paid', 'Paid')
    expect(srLabel).toBe('Paid')
    render(<>{display}</>)
    expect(screen.getByText('Paid')).toBeDefined()
  })
})

describe('moneyAmountCell', () => {
  it('renders formatted amount with visible text', () => {
    const fmt = (n: number) => `$${n.toFixed(2)}`
    render(<>{moneyAmountCell(100, fmt, 'positive')}</>)
    expect(screen.getByText('$100.00')).toBeDefined()
  })
})
