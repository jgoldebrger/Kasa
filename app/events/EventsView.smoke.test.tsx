/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { beforeAll, describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import EventsView from './EventsView'

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver
})

const stubEvent = {
  _id: 'event-smoke-1',
  familyId: 'fam-1',
  familyName: 'Smoke Family',
  eventType: 'bar_mitzvah',
  eventTypeLabel: 'Bar Mitzvah',
  eventDate: '2024-06-01',
  year: 2024,
  amount: 100,
  notes: '',
}

describe('EventsView smoke', () => {
  it('renders without crashing', () => {
    const { container } = render(<EventsView initialEvents={[stubEvent]} />)
    expect(container).toBeDefined()
  })
})
