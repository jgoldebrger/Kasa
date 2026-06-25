import { describe, it, expect } from 'vitest'
import { sortEventRows } from '@/lib/events/sort-events'

const rows = [
  {
    familyName: 'Beta',
    eventType: 'wedding',
    eventTypeLabel: 'Wedding',
    eventDate: '2024-06-01',
    year: 2024,
    amount: 500,
    notes: 'b',
  },
  {
    familyName: 'Alpha',
    eventType: 'barmitzvah',
    eventTypeLabel: 'Bar Mitzvah',
    eventDate: '2024-01-15',
    year: 2024,
    amount: 300,
    notes: 'a',
  },
]

describe('sortEventRows', () => {
  it('returns rows unchanged when sort is null', () => {
    expect(sortEventRows(rows, null)).toEqual(rows)
  })

  it('sorts by event date descending', () => {
    const sorted = sortEventRows(rows, { id: 'eventDate', dir: 'desc' })
    expect(sorted[0].familyName).toBe('Beta')
  })

  it('sorts by family name ascending', () => {
    const sorted = sortEventRows(rows, { id: 'family', dir: 'asc' })
    expect(sorted[0].familyName).toBe('Alpha')
  })

  it('sorts by amount ascending', () => {
    const sorted = sortEventRows(rows, { id: 'amount', dir: 'asc' })
    expect(sorted[0].amount).toBe(300)
  })
})
