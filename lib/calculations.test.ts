import { describe, expect, it } from 'vitest'
import { buildPaymentYearFilter } from './calculations'
import { netPaymentAmount } from './money'

describe('netPaymentAmount', () => {
  it('nets partial refunds against the original payment amount', () => {
    expect(netPaymentAmount({ amount: 100, refundedAmount: 25 })).toBe(75)
  })

  it('never returns a negative contribution when refund exceeds amount', () => {
    expect(netPaymentAmount({ amount: 50, refundedAmount: 60 })).toBe(0)
  })
})

describe('buildPaymentYearFilter', () => {
  it('treats Payment.year as the source of truth, with paymentDate as a fallback', () => {
    const filter = buildPaymentYearFilter(2024, 'org-1', 'UTC') as {
      organizationId: string
      $or: Array<Record<string, unknown>>
    }
    expect(filter.organizationId).toBe('org-1')
    expect(filter.$or).toHaveLength(2)

    const [yearClause, fallbackClause] = filter.$or as [
      { year: number },
      { year: null; paymentDate: { $gte: Date; $lt: Date } },
    ]
    expect(yearClause).toEqual({ year: 2024 })

    expect(fallbackClause.year).toBeNull()
    expect(fallbackClause.paymentDate.$gte).toEqual(new Date(Date.UTC(2024, 0, 1, 0, 0, 0, 0)))
    expect(fallbackClause.paymentDate.$lt).toEqual(new Date(Date.UTC(2025, 0, 1, 0, 0, 0, 0)))
  })

  it('uses UTC year bounds when timezone is omitted', () => {
    const filter = buildPaymentYearFilter(2024, 'org-1') as unknown as { $or: [{ year: number }, { year: null; paymentDate: { $gte: Date; $lt: Date } }]
    }
    expect(filter.$or[1].paymentDate.$gte).toEqual(new Date(Date.UTC(2024, 0, 1)))
    expect(filter.$or[1].paymentDate.$lt).toEqual(new Date(Date.UTC(2025, 0, 1)))
  })

  it('uses org timezone for paymentDate fallback bounds', () => {
    const filter = buildPaymentYearFilter(2024, 'org-1', 'America/New_York') as unknown as { $or: [{ year: number }, { year: null; paymentDate: { $gte: Date; $lt: Date } }]
    }
    expect(filter.$or[1].paymentDate.$gte.toISOString()).toBe('2024-01-01T05:00:00.000Z')
    expect(filter.$or[1].paymentDate.$lt.toISOString()).toBe('2025-01-01T05:00:00.000Z')
  })

  it('treats null timezone like UTC', () => {
    const withNull = buildPaymentYearFilter(2024, 'org-1', null) as unknown as { $or: [{ year: number }, { year: null; paymentDate: { $gte: Date; $lt: Date } }]
    }
    const withUtc = buildPaymentYearFilter(2024, 'org-1', 'UTC') as unknown as { $or: [{ year: number }, { year: null; paymentDate: { $gte: Date; $lt: Date } }]
    }
    expect(withNull.$or[1].paymentDate.$gte.getTime()).toBe(withUtc.$or[1].paymentDate.$gte.getTime())
    expect(withNull.$or[1].paymentDate.$lt.getTime()).toBe(withUtc.$or[1].paymentDate.$lt.getTime())
  })

  it('does not match a 2023 payment from the 2024 query', () => {
    // The old `$or: [{ year }, { paymentDate: ... }]` shape would have
    // pulled a `{ year: 2023, paymentDate: 2024-... }` doc into both
    // years. The new filter only counts it under 2023.
    const filter = buildPaymentYearFilter(2024, 'org-1') as unknown as { $or: Array<Record<string, unknown>>
    }
    const matchesYearClause = (filter.$or[0] as { year: number }).year === 2023
    expect(matchesYearClause).toBe(false)
    // Fallback only applies when year is null, so a tagged 2023 payment
    // can't sneak in via paymentDate either.
    const fallback = filter.$or[1] as { year: null }
    expect(fallback.year).toBeNull()
  })
})
