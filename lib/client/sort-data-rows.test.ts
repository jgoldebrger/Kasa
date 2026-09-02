import { describe, expect, it } from 'vitest'
import { columnIsSortable, sortDataRows } from '@/lib/client/sort-data-rows'

type Row = { name: string; amount: number; date: string }

const columns = [
  {
    id: 'name',
    exportValue: (r: Row) => r.name,
    cell: (r: Row) => r.name,
  },
  {
    id: 'amount',
    exportValue: (r: Row) => r.amount,
    cell: (r: Row) => r.amount,
  },
  {
    id: 'actions',
    exportValue: () => '',
    cell: () => null,
  },
]

const rows: Row[] = [
  { name: 'Beta', amount: 20, date: '2024-02-01' },
  { name: 'Alpha', amount: 10, date: '2024-01-01' },
  { name: 'Gamma', amount: 30, date: '2024-03-01' },
]

describe('columnIsSortable', () => {
  it('treats data columns with exportValue as sortable by default', () => {
    expect(columnIsSortable(columns[0])).toBe(true)
  })

  it('excludes action columns even when they have exportValue', () => {
    expect(columnIsSortable(columns[2])).toBe(false)
  })
})

describe('sortDataRows', () => {
  it('returns rows unchanged when sort is null', () => {
    expect(sortDataRows(rows, null, columns)).toEqual(rows)
  })

  it('sorts strings ascending', () => {
    const sorted = sortDataRows(rows, { id: 'name', dir: 'asc' }, columns)
    expect(sorted.map((r) => r.name)).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('sorts numbers descending', () => {
    const sorted = sortDataRows(rows, { id: 'amount', dir: 'desc' }, columns)
    expect(sorted.map((r) => r.amount)).toEqual([30, 20, 10])
  })
})
