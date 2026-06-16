import { describe, expect, it } from 'vitest'
import enUS from './en-US.json'
import heIL from './he-IL.json'

describe('i18n messages', () => {
  it('en-US catalog is non-empty', () => {
    expect(Object.keys(enUS).length).toBeGreaterThan(50)
  })

  it('he-IL includes all en-US keys', () => {
    for (const key of Object.keys(enUS)) {
      expect(heIL).toHaveProperty(key)
    }
  })
})
