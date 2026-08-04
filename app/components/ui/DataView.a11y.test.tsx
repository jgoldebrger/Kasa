/**
 * @vitest-environment happy-dom
 */
import React from 'react'
import { afterEach, beforeAll, describe, it, expect, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DataView } from './DataView'

type Row = { id: string; name: string; amount: number }

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

afterEach(cleanup)

describe('DataView a11y', () => {
  it('exposes aria-sort on the active sortable column', () => {
    const onSortChange = vi.fn()
    render(
      <DataView
        columns={[
          {
            id: 'name',
            header: 'Name',
            sortable: true,
            cell: (r: Row) => r.name,
          },
        ]}
        rows={[{ id: '1', name: 'Ada', amount: 10 }]}
        rowKey={(r) => r.id}
        mobileCard={(r) => <div>{r.name}</div>}
        tableId="a11y-dv"
        toolbar={false}
        sort={{ id: 'name', dir: 'asc' }}
        onSortChange={onSortChange}
      />,
    )
    expect(screen.getByRole('columnheader', { name: /name/i }).getAttribute('aria-sort')).toBe(
      'ascending',
    )
  })

  it('gives every column header scope="col"', () => {
    render(
      <DataView
        columns={[
          { id: 'name', header: 'Name', cell: (r: Row) => r.name },
          { id: 'amount', header: 'Amount', align: 'end', cell: (r: Row) => r.amount },
        ]}
        rows={[{ id: '1', name: 'Ada', amount: 10 }]}
        rowKey={(r) => r.id}
        mobileCard={(r) => <div>{r.name}</div>}
        tableId="a11y-dv-scope"
        toolbar={false}
      />,
    )
    const headers = screen.getAllByRole('columnheader')
    expect(headers.length).toBeGreaterThan(0)
    for (const header of headers) {
      expect(header.getAttribute('scope')).toBe('col')
    }
  })

  it('announces filtered result count in a polite live region', async () => {
    render(
      <DataView
        columns={[
          {
            id: 'name',
            header: 'Name',
            cell: (r: Row) => r.name,
          },
        ]}
        rows={[
          { id: '1', name: 'Ada', amount: 10 },
          { id: '2', name: 'Grace', amount: 20 },
        ]}
        rowKey={(r) => r.id}
        mobileCard={(r) => <div>{r.name}</div>}
        tableId="a11y-dv-search"
        globalSearch
      />,
    )
    const live = document.querySelector('[aria-live="polite"]')
    expect(live).toBeTruthy()
    expect(live?.textContent || '').toMatch(/2/)

    const search = screen.getByRole('searchbox')
    fireEvent.change(search, { target: { value: 'Ada' } })
    await waitFor(() => {
      expect(document.querySelector('[aria-live="polite"]')?.textContent || '').toMatch(/1/)
    })
  })

  it('names Previous/Next pagination controls and flips chevrons under rtl', () => {
    const rows: Row[] = Array.from({ length: 25 }, (_, i) => ({
      id: String(i),
      name: `Row ${i}`,
      amount: i,
    }))
    document.documentElement.setAttribute('dir', 'rtl')
    try {
      render(
        <DataView
          columns={[{ id: 'name', header: 'Name', cell: (r: Row) => r.name }]}
          rows={rows}
          rowKey={(r) => r.id}
          mobileCard={(r) => <div>{r.name}</div>}
          tableId="a11y-dv-pagination"
          toolbar={false}
          pageSize={10}
        />,
      )
      const prevButtons = screen.getAllByRole('button', { name: 'Previous page' })
      const nextButtons = screen.getAllByRole('button', { name: 'Next page' })
      expect(prevButtons.length).toBeGreaterThan(0)
      expect(nextButtons.length).toBeGreaterThan(0)
      for (const btn of [...prevButtons, ...nextButtons]) {
        const svg = btn.querySelector('svg')
        expect(svg?.getAttribute('class') || '').toMatch(/rtl:rotate-180/)
      }
    } finally {
      document.documentElement.removeAttribute('dir')
    }
  })
})
