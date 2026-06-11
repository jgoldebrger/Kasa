import { describe, expect, it, vi } from 'vitest'
import {
  buildIdempotencyKey,
  fromMinorUnits,
  netPaymentAmount,
  resolveStripeCurrency,
  roundMoney,
  sumMoney,
  toMinorUnits,
} from './money'

vi.mock('./models', () => ({
  Organization: {
    findById: vi.fn(() => ({
      select: vi.fn(() => ({
        lean: vi.fn(async () => ({ currency: 'EUR', locale: 'fr-FR' })),
      })),
    })),
  },
}))

describe('roundMoney', () => {
  it('rounds to two decimals and guards non-finite input', () => {
    expect(roundMoney(10.005)).toBe(10.01)
    expect(roundMoney(Number.NaN)).toBe(0)
  })
})

describe('sumMoney', () => {
  it('sums finite values and ignores nullish entries', () => {
    expect(sumMoney([1.1, null, 2.2, undefined, Number.NaN])).toBe(3.3)
  })
})

describe('netPaymentAmount', () => {
  it('never returns negative net amounts', () => {
    expect(netPaymentAmount({ amount: 50, refundedAmount: 60 })).toBe(0)
  })
})

describe('toMinorUnits / fromMinorUnits', () => {
  it('avoids float drift for USD cents', () => {
    expect(toMinorUnits(10.05)).toBe(1005)
    expect(fromMinorUnits(1005)).toBe(10.05)
  })

  it('uses zero-decimal exponent for JPY', () => {
    expect(toMinorUnits(1000, 'JPY')).toBe(1000)
    expect(fromMinorUnits(1000, 'JPY')).toBe(1000)
  })

  it('rejects invalid amounts', () => {
    expect(() => toMinorUnits(Number.NaN)).toThrow(/finite/)
    expect(() => toMinorUnits(-1)).toThrow(/finite/)
  })
})

describe('resolveStripeCurrency', () => {
  it('falls back to usd for unsupported codes', () => {
    expect(resolveStripeCurrency('XXX')).toBe('usd')
    expect(resolveStripeCurrency('ILS')).toBe('ils')
  })
})

describe('buildIdempotencyKey', () => {
  it('joins parts and caps length at 255', () => {
    const key = buildIdempotencyKey(['org', 1, null, 'pay'])
    expect(key).toBe('org:1::pay')
    expect(buildIdempotencyKey(['x'.repeat(300)]).length).toBe(255)
  })
})

describe('getOrgCurrency', () => {
  it('reads organization currency from the database', async () => {
    const { getOrgCurrency, getOrgMoneyContext } = await import('./money.server')
    await expect(getOrgCurrency('org-1')).resolves.toBe('EUR')
    await expect(getOrgMoneyContext('org-1')).resolves.toEqual({
      currency: 'EUR',
      locale: 'fr-FR',
    })
  })
})
