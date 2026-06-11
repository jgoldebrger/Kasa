'use client'

import { useCallback, useRef } from 'react'

/**
 * Generation counter for in-flight fetches. Bump on org switch, route-param
 * change, or effect cleanup so stale responses cannot overwrite fresh state.
 */
export function useRequestGeneration() {
  const genRef = useRef(0)

  const begin = useCallback(() => ++genRef.current, [])

  const invalidate = useCallback(() => {
    genRef.current += 1
  }, [])

  const isStale = useCallback((gen: number) => genRef.current !== gen, [])

  /** Latest generation counter — for parallel fetches that share one batch. */
  const current = useCallback(() => genRef.current, [])

  return { begin, invalidate, isStale, current }
}
