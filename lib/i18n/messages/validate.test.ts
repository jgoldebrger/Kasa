import { describe, expect, it } from 'vitest'
import enUS from './en-US.json'
import heIL from './he-IL.json'

describe('i18n messages', () => {
  it('en-US catalog is non-empty', () => {
    expect(Object.keys(enUS).length).toBeGreaterThan(50)
  })

  // he-IL is kept in sync with en-US keys (untranslated keys fall back to en-US
  // copy). When adding strings to en-US.json, run the backfill in CI or mirror
  // manually — otherwise this parity check fails.
  it('he-IL includes all en-US keys', () => {
    for (const key of Object.keys(enUS)) {
      expect(heIL).toHaveProperty(key)
    }
  })
})
