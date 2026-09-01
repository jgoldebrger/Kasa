import { describe, expect, it } from 'vitest'
import { redactCheckInfoForExport, sanitizeRoutingNumber } from './sanitize-check-info'

describe('sanitizeRoutingNumber', () => {
  it('masks all but last 4 digits', () => {
    expect(sanitizeRoutingNumber('021000021')).toBe('*****0021')
  })

  it('returns undefined for short values', () => {
    expect(sanitizeRoutingNumber('123')).toBeUndefined()
  })
})

describe('redactCheckInfoForExport', () => {
  it('redacts routing numbers in check info', () => {
    const out = redactCheckInfoForExport({
      checkNumber: '100',
      routingNumber: '021000021',
    })
    expect(out?.routingNumber).toBe('*****0021')
  })
})
