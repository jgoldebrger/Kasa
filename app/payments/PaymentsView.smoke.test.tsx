/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { beforeAll, describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import PaymentsView from './PaymentsView'

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver
})

const stubPayment = {
  _id: 'pay-smoke-1',
  familyId: { _id: 'fam-1', name: 'Smoke Family' },
  amount: 100,
  paymentDate: '2024-01-15',
  year: 2024,
  type: 'membership' as const,
  paymentMethod: 'cash' as const,
  createdAt: '2024-01-15T00:00:00.000Z',
}

describe('PaymentsView smoke', () => {
  it('renders without crashing', () => {
    const { container } = render(<PaymentsView initialPayments={[stubPayment]} />)
    expect(container).toBeDefined()
  })
})
