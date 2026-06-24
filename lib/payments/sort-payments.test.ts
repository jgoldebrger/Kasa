import { describe, it, expect } from 'vitest'
import { sortPaymentRows } from '@/lib/payments/sort-payments'

const rows = [
  {
    paymentDate: '2024-06-01',
    familyId: { name: 'Beta' },
    amount: 50,
    type: 'donation',
    paymentMethod: 'cash',
    year: 2024,
  },
  {
    paymentDate: '2024-01-15',
    familyId: { name: 'Alpha' },
    amount: 100,
    type: 'membership',
    paymentMethod: 'check',
    year: 2023,
  },
]

describe('sortPaymentRows', () => {
  it('returns rows unchanged when sort is null', () => {
    expect(sortPaymentRows(rows, null)).toEqual(rows)
  })

  it('sorts by date descending', () => {
    const sorted = sortPaymentRows(rows, { id: 'date', dir: 'desc' })
    expect(sorted[0].familyId?.name).toBe('Beta')
  })

  it('sorts by family name ascending', () => {
    const sorted = sortPaymentRows(rows, { id: 'family', dir: 'asc' })
    expect(sorted[0].familyId?.name).toBe('Alpha')
  })

  it('sorts by amount ascending', () => {
    const sorted = sortPaymentRows(rows, { id: 'amount', dir: 'asc' })
    expect(sorted[0].amount).toBe(50)
  })
})
