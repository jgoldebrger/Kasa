import { describe, it, expect } from 'vitest'
import { buildFieldIds } from './field-ids'

describe('buildFieldIds', () => {
  it('prefers explicit id and builds describedBy', () => {
    const ids = buildFieldIds('auto', 'email')
    expect(ids.fieldId).toBe('email')
    expect(ids.describedBy('hint text', 'boom')).toBe('email-hint email-err')
    expect(ids.describedBy(undefined, null)).toBeUndefined()
  })
})
