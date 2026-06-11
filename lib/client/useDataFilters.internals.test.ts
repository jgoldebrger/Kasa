import { describe, expect, it } from 'vitest'
import { useDataFiltersInternals } from './useDataFilters'

type Row = { name: string; ok: boolean }

describe('useDataFilters internals', () => {
  it('covers defensive display, emptiness, and match branches', () => {
    const { displayValue, isEmpty, matchValue, getRowText, getRowValue } =
      useDataFiltersInternals!
    expect(displayValue({ type: 'numberRange', min: null, max: null })).toBe('')
    expect(displayValue({ type: 'dateRange', from: null, to: null })).toBe('')
    expect(displayValue({ type: 'bogus' } as never)).toBe('')
    expect(isEmpty({ type: 'bogus' } as never)).toBe(true)
    expect(matchValue('x', { type: 'bogus' } as never)).toBe(true)
    expect(matchValue('no', { type: 'boolean', value: false })).toBe(true)

    const exportCol = {
      id: 'name',
      exportValue: (r: Row) => r.name,
      cell: () => {
        throw new Error('render fail')
      },
    }
    expect(getRowText({ name: 'Ada', ok: true }, exportCol)).toBe('Ada')
    expect(getRowValue({ name: 'Ada', ok: true }, exportCol)).toBe('Ada')

    const throwingCol = {
      id: 'broken',
      cell: () => {
        throw new Error('render fail')
      },
    }
    expect(getRowText({ name: 'Ada', ok: true }, throwingCol)).toBe('')
    expect(getRowValue({ name: 'Ada', ok: true }, throwingCol)).toBe('')
  })
})
