/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { beforeAll, describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import RecurringPaymentsView from './RecurringPaymentsView'

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver
})

describe('RecurringPaymentsView smoke', () => {
  it('renders without crashing', () => {
    const { container } = render(<RecurringPaymentsView />)
    expect(container).toBeDefined()
  })
})
