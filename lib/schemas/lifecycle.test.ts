import { describe, expect, it } from 'vitest'
import { lifecycleEventTypeUpdateBody } from './lifecycle'

describe('lifecycle schemas', () => {
  it('rejects an empty lifecycle event type update body', () => {
    const result = lifecycleEventTypeUpdateBody.safeParse({})
    expect(result.success).toBe(false)
  })

  it('accepts a partial lifecycle event type update', () => {
    const result = lifecycleEventTypeUpdateBody.safeParse({ name: 'Bar Mitzvah fee' })
    expect(result.success).toBe(true)
  })
})
