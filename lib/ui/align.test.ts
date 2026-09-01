import { describe, it, expect } from 'vitest'
import { textAlignClass } from './align'

describe('textAlignClass', () => {
  it('maps physical left/right to logical classes', () => {
    expect(textAlignClass('left')).toBe('text-start')
    expect(textAlignClass('right')).toBe('text-end')
    expect(textAlignClass('start')).toBe('text-start')
  })
})
