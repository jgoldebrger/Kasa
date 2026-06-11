import { describe, expect, it } from 'vitest'
import { REPORT_SOURCES, getSourceDef } from './report-builder'

describe('report-builder (smoke)', () => {
  it('exposes all four report sources with dimensions', () => {
    expect(REPORT_SOURCES.map((s) => s.id).sort()).toEqual([
      'events',
      'families',
      'members',
      'payments',
    ])
    for (const src of REPORT_SOURCES) {
      expect(src.label.length).toBeGreaterThan(0)
      expect(src.dateField.length).toBeGreaterThan(0)
      expect(src.dimensions.length).toBeGreaterThan(0)
    }
  })

  it('getSourceDef returns metadata for a known source', () => {
    const def = getSourceDef('payments')
    expect(def?.id).toBe('payments')
    expect(def?.dateField).toBe('paymentDate')
  })

  it('getSourceDef returns null for unknown sources', () => {
    expect(getSourceDef('unknown' as any)).toBeNull()
  })
})
