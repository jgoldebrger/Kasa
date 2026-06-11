/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { beforeAll, describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ToastProvider } from '@/app/components/Toast'
import StatementsView from './StatementsView'

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver
})

const stubStatement = {
  _id: 'stmt-smoke-1',
  familyId: 'fam-1',
  statementNumber: '2024-001',
  date: '2024-01-31',
  fromDate: '2024-01-01',
  toDate: '2024-01-31',
  openingBalance: 0,
  income: 100,
  withdrawals: 0,
  expenses: 0,
  closingBalance: 100,
}

const stubFamily = {
  _id: 'fam-1',
  name: 'Smoke Family',
}

describe('StatementsView smoke', () => {
  it('renders without crashing', () => {
    const { container } = render(
      <ToastProvider>
        <StatementsView
          initialStatements={[stubStatement]}
          initialFamilies={[stubFamily]}
        />
      </ToastProvider>,
    )
    expect(container).toBeDefined()
  })
})
