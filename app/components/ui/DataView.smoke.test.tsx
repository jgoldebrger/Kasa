/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { beforeAll, describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { DataView } from './DataView'

type Row = { id: string; name: string }

const columns = [
  {
    id: 'name',
    header: 'Name',
    cell: (row: Row) => row.name,
  },
]

const rows: Row[] = [{ id: '1', name: 'Smoke Row' }]

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver
})

describe('DataView smoke', () => {
  it('renders without crashing', () => {
    const { container } = render(
      <DataView
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        mobileCard={(row) => <div>{row.name}</div>}
        tableId="smoke-dataview"
        toolbar={false}
      />,
    )
    expect(container).toBeDefined()
  })
})
