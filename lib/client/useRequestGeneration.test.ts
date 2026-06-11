import { describe, expect, it } from 'vitest'

/**
 * Mirrors the generation-counter contract used by useRequestGeneration and
 * the manual *GenRef patterns on family/settings pages. Guards org-switch
 * races without requiring a React test environment.
 */
function createRequestGeneration() {
  let gen = 0
  return {
    begin: () => ++gen,
    invalidate: () => {
      gen += 1
    },
    isStale: (started: number) => gen !== started,
    current: () => gen,
  }
}

describe('request generation guard (org-switch contract)', () => {
  it('marks earlier requests stale after invalidate', () => {
    const { begin, invalidate, isStale } = createRequestGeneration()
    const first = begin()
    invalidate()
    expect(isStale(first)).toBe(true)
  })

  it('keeps the latest request fresh while an older one is stale', async () => {
    const { begin, invalidate, isStale } = createRequestGeneration()
    const old = begin()
    invalidate()
    const fresh = begin()

    await Promise.resolve()

    expect(isStale(old)).toBe(true)
    expect(isStale(fresh)).toBe(false)
  })

  it('exposes current generation for shared parallel fetches', () => {
    const { begin, current } = createRequestGeneration()
    const gen = begin()
    expect(current()).toBe(gen)
  })

  it('simulates org switch during an in-flight fetch', async () => {
    const { begin, invalidate, isStale } = createRequestGeneration()
    const orgA = begin()

    invalidate() // org switch
    const orgB = begin()

    const results: string[] = []
    const finish = (gen: number, label: string) => {
      if (!isStale(gen)) results.push(label)
    }

    finish(orgA, 'org-a')
    finish(orgB, 'org-b')

    expect(results).toEqual(['org-b'])
  })
})
