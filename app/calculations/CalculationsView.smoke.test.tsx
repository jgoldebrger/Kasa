/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { beforeAll, describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import CalculationsView from './CalculationsView'

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver
})

const stubCalculation = {
  _id: 'calc-smoke-1',
  year: 2024,
  byPlan: [],
  byEvent: [],
  totalPayments: 0,
  planIncome: 0,
  totalIncome: 0,
  totalExpenses: 0,
  extraDonation: 0,
  extraExpense: 0,
  calculatedIncome: 0,
  calculatedExpenses: 0,
  balance: 0,
}

describe('CalculationsView smoke', () => {
  it('renders without crashing', () => {
    const { container } = render(
      <CalculationsView initialCalculations={[stubCalculation]} />,
    )
    expect(container).toBeDefined()
  })
})
