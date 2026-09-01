import { describe, it, expect } from 'vitest'
import { getWritingDirection, horizontalNavDelta } from './writing-direction'

describe('writing-direction', () => {
  it('defaults to ltr without a document dir', () => {
    expect(getWritingDirection(null)).toBe('ltr')
  })

  it('maps arrow keys for rtl', () => {
    expect(horizontalNavDelta('ArrowRight', 'rtl')).toBe(-1)
    expect(horizontalNavDelta('ArrowLeft', 'rtl')).toBe(1)
    expect(horizontalNavDelta('ArrowRight', 'ltr')).toBe(1)
  })
})
