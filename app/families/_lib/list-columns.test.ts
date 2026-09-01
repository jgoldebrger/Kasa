import { describe, it, expect } from 'vitest'
import type { DataColumn } from '@/app/components/ui'
import { filterFamiliesListColumns } from './list-columns'

const columns: DataColumn<{ id: string }>[] = [
  { id: 'select', header: 'Select', cell: () => null },
  { id: 'name', header: 'Name', cell: () => null },
  { id: 'plan', header: 'Plan', cell: () => null },
  { id: 'balance', header: 'Balance', cell: () => null },
  { id: 'actions', header: 'Actions', cell: () => null },
]

describe('filterFamiliesListColumns', () => {
  it('returns all columns for admins', () => {
    expect(filterFamiliesListColumns(columns, true).map((c) => c.id)).toEqual([
      'select',
      'name',
      'plan',
      'balance',
      'actions',
    ])
  })

  it('hides select, plan, balance, and actions for members', () => {
    expect(filterFamiliesListColumns(columns, false).map((c) => c.id)).toEqual(['name'])
  })
})
