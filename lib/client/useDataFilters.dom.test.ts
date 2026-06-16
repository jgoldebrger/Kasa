/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDataFilters, type FilterableColumn } from './useDataFilters'

const SEARCH_DEBOUNCE_MS = 200

function flushSearchDebounce() {
  act(() => {
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS)
  })
}

type Row = {
  name: string
  amount: number
  active: boolean
  joined: string
  tags: string
  paid: boolean
  note: string
}

const baseColumns: FilterableColumn<Row>[] = [
  {
    id: 'name',
    headerText: 'Name',
    filter: { type: 'text' },
    cell: (r) => r.name,
  },
  {
    id: 'amount',
    headerText: 'Amount',
    filter: { type: 'numberRange', getValue: (r) => r.amount },
    cell: (r) => r.amount,
  },
  {
    id: 'status',
    headerText: 'Active',
    filter: {
      type: 'select',
      options: [{ value: 'true', label: 'Yes' }],
      getValue: (r) => (r.active ? 'true' : 'false'),
    },
    cell: (r) => (r.active ? 'Yes' : 'No'),
  },
  {
    id: 'joined',
    headerText: 'Joined',
    filter: { type: 'dateRange', getValue: (r) => r.joined },
    cell: (r) => r.joined,
  },
]

const rows: Row[] = [
  {
    name: 'Alice',
    amount: 10,
    active: true,
    joined: '2024-01-15',
    tags: 'a',
    paid: true,
    note: 'ok',
  },
  {
    name: 'Bob',
    amount: 50,
    active: false,
    joined: '2024-06-01',
    tags: 'b',
    paid: false,
    note: '',
  },
]

describe('useDataFilters', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('filters by global search and column filters', () => {
    const { result } = renderHook(() =>
      useDataFilters(baseColumns, rows, { globalSearch: true }),
    )

    act(() => {
      result.current.setSearch('ali')
    })
    flushSearchDebounce()
    expect(result.current.filteredRows.map((r) => r.name)).toEqual(['Alice'])
    expect(result.current.activeCount).toBe(1)

    act(() => {
      result.current.setColumnFilter('amount', { type: 'numberRange', min: 20, max: null })
    })
    expect(result.current.filteredRows).toHaveLength(0)

    act(() => {
      result.current.clearAll()
    })
    expect(result.current.filteredRows).toHaveLength(2)
    expect(result.current.activeCount).toBe(0)
  })

  it('auto-extracts select options and builds active filter chips', () => {
    const { result } = renderHook(() => useDataFilters(baseColumns, rows))

    expect(result.current.optionsByColumn.status).toEqual([{ value: 'true', label: 'Yes' }])
    expect(result.current.hasAnyFilterable).toBe(true)

    act(() => {
      result.current.setColumnFilter('status', { type: 'select', value: 'true' })
    })
    expect(result.current.filteredRows).toEqual([rows[0]])
    expect(result.current.activeFilters[0]).toMatchObject({ id: 'status', label: 'Active' })

    act(() => {
      result.current.setColumnFilter('status', null)
      result.current.setColumnFilter('amount', { type: 'numberRange', min: 40, max: null })
    })
    expect(result.current.filteredRows).toEqual([rows[1]])
    expect(result.current.activeFilters[0]).toMatchObject({ id: 'amount', display: '≥ 40' })
  })

  it('rejects invalid dateRange bounds and rows with unparseable dates', () => {
    const { result } = renderHook(() => useDataFilters(baseColumns, rows))

    act(() => {
      result.current.setColumnFilter('joined', {
        type: 'dateRange',
        from: '2099-01-01',
        to: 'not-a-date',
      })
    })
    expect(result.current.filteredRows).toHaveLength(0)

    act(() => {
      result.current.setColumnFilter('joined', { type: 'dateRange', from: null, to: null })
    })
    expect(result.current.filteredRows).toHaveLength(2)

    const badDateCols: FilterableColumn<Row>[] = [
      {
        id: 'joined',
        header: 'Joined',
        filter: { type: 'dateRange', getValue: () => 'garbage' },
        cell: () => 'garbage',
      },
    ]
    const { result: bad } = renderHook(() => useDataFilters(badDateCols, rows))
    act(() => {
      bad.current.setColumnFilter('joined', {
        type: 'dateRange',
        from: '2024-01-01',
        to: '2024-12-31',
      })
    })
    expect(bad.current.filteredRows).toHaveLength(0)
    expect(bad.current.activeFilters[0]?.display).toBe('2024-01-01 → 2024-12-31')
  })

  it('filters booleans from boolean values and yes/no strings', () => {
    const cols: FilterableColumn<Row>[] = [
      {
        id: 'paid',
        filter: { type: 'boolean', getValue: (r) => r.paid },
        cell: (r) => r.paid,
      },
      {
        id: 'legacy',
        filter: { type: 'boolean' },
        exportValue: (r) => (r.note === 'ok' ? 'yes' : 'no'),
        cell: (r) => r.note,
      },
    ]
    const { result } = renderHook(() => useDataFilters(cols, rows))

    act(() => {
      result.current.setColumnFilter('paid', { type: 'boolean', value: true })
    })
    expect(result.current.filteredRows).toEqual([rows[0]])
    expect(result.current.activeFilters[0]?.display).toBe('Yes')

    act(() => {
      result.current.setColumnFilter('paid', { type: 'boolean', value: false })
    })
    expect(result.current.filteredRows).toEqual([rows[1]])

    act(() => {
      result.current.setColumnFilter('paid', null)
      result.current.setColumnFilter('legacy', { type: 'boolean', value: true })
    })
    expect(result.current.filteredRows).toEqual([rows[0]])
    expect(result.current.activeFilters[0]?.display).toBe('Yes')
  })

  it('clears filters when set to null or empty values', () => {
    const { result } = renderHook(() => useDataFilters(baseColumns, rows))

    act(() => {
      result.current.setColumnFilter('name', { type: 'text', value: 'Alice' })
    })
    expect(result.current.columnFilters.name).toBeDefined()

    act(() => {
      result.current.setColumnFilter('name', { type: 'text', value: '   ' })
    })
    expect(result.current.columnFilters.name).toBeUndefined()

    act(() => {
      result.current.setColumnFilter('amount', { type: 'numberRange', min: 5, max: 100 })
      result.current.setColumnFilter('amount', null)
    })
    expect(result.current.columnFilters.amount).toBeUndefined()
  })

  it('sorts auto-extracted options and handles empty option lists', () => {
    const cols: FilterableColumn<Row>[] = [
      {
        id: 'tags',
        filter: { type: 'multiselect', getValue: (r) => r.tags },
        cell: (r) => r.tags,
      },
      {
        id: 'empty',
        filter: { type: 'select' },
        cell: () => '',
      },
    ]
    const { result } = renderHook(() => useDataFilters(cols, rows))

    expect(result.current.optionsByColumn.tags?.map((o) => o.value)).toEqual(['a', 'b'])
    expect(result.current.optionsByColumn.empty).toEqual([])

    act(() => {
      result.current.setColumnFilter('tags', { type: 'multiselect', value: ['a', 'b', 'c'] })
    })
    expect(result.current.activeFilters[0]?.display).toBe('a, b +1')
  })

  it('covers number, date, multiselect chips, and custom global search', () => {
    const cols: FilterableColumn<Row>[] = [
      ...baseColumns,
      {
        id: 'amountExact',
        headerText: 'Exact',
        filter: { type: 'number', getValue: (r) => r.amount },
        cell: (r) => r.amount,
      },
      {
        id: 'joinedDay',
        headerText: 'Day',
        filter: { type: 'date', getValue: (r) => r.joined },
        cell: (r) => r.joined,
      },
    ]
    const { result } = renderHook(() =>
      useDataFilters(cols, rows, {
        globalSearch: { getValue: (r) => r.name },
      }),
    )

    act(() => {
      result.current.setColumnFilter('amountExact', { type: 'number', value: 50 })
      result.current.setColumnFilter('joinedDay', { type: 'date', value: '2024-06-01' })
      result.current.setColumnFilter('amount', { type: 'numberRange', min: 1, max: 100 })
    })
    expect(result.current.filteredRows).toEqual([rows[1]])
    expect(result.current.activeFilters.map((f) => f.display)).toEqual(
      expect.arrayContaining(['50', '2024-06-01', '1 – 100']),
    )

    act(() => {
      result.current.activeFilters.find((f) => f.id === 'amount')?.clear()
    })
    expect(result.current.filteredRows).toHaveLength(1)
  })

  it('shows dateRange to-only chip and clears search via chip', () => {
    const { result } = renderHook(() =>
      useDataFilters(baseColumns, rows, { globalSearch: true }),
    )

    act(() => {
      result.current.setSearch('bob')
      result.current.setColumnFilter('joined', { type: 'dateRange', from: null, to: '2024-03-01' })
    })
    flushSearchDebounce()
    expect(result.current.activeFilters.map((f) => f.display)).toEqual(
      expect.arrayContaining(['"bob"', 'to 2024-03-01']),
    )

    act(() => {
      result.current.activeFilters.find((f) => f.id === '__search__')?.clear()
    })
    expect(result.current.search).toBe('')
  })

  it('shows numberRange max-only chip and multiselect short list display', () => {
    const cols: FilterableColumn<Row>[] = [
      {
        id: 'amount',
        filter: { type: 'numberRange', getValue: (r) => r.amount },
        cell: (r) => r.amount,
      },
      {
        id: 'tags',
        filter: { type: 'multiselect', getValue: (r) => r.tags },
        cell: (r) => r.tags,
      },
    ]
    const { result } = renderHook(() => useDataFilters(cols, rows))

    act(() => {
      result.current.setColumnFilter('amount', { type: 'numberRange', min: null, max: 20 })
      result.current.setColumnFilter('tags', { type: 'multiselect', value: ['a'] })
    })
    expect(result.current.activeFilters.map((f) => f.display)).toEqual(
      expect.arrayContaining(['≤ 20', 'a']),
    )
  })

  it('uses exportValue and survives throwing cells', () => {
    const cols: FilterableColumn<Row>[] = [
      {
        id: 'broken',
        filter: { type: 'text' },
        exportValue: (r) => r.name,
        cell: () => {
          throw new Error('render fail')
        },
      },
    ]
    const { result } = renderHook(() => useDataFilters(cols, rows))

    act(() => {
      result.current.setColumnFilter('broken', { type: 'text', value: 'Ali' })
    })
    expect(result.current.filteredRows).toEqual([rows[0]])
  })
})
