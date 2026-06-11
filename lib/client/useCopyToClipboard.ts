'use client'

import { useCallback, useRef, useState } from 'react'

/**
 * Copy text to the clipboard with a 2-second "copied" flag for UI
 * feedback. Falls back to a hidden textarea trick where the modern
 * clipboard API is blocked (insecure context, old browsers).
 *
 * Example:
 *   const { copy, copied } = useCopyToClipboard()
 *   <Button onClick={() => copy(token)}>{copied ? 'Copied!' : 'Copy'}</Button>
 */
export function useCopyToClipboard(resetMs = 2000) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<NodeJS.Timeout | null>(null)

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      if (timer.current) clearTimeout(timer.current)
      let ok = false
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text)
          ok = true
        } else if (typeof document !== 'undefined') {
          const ta = document.createElement('textarea')
          ta.value = text
          ta.setAttribute('readonly', '')
          ta.style.position = 'absolute'
          ta.style.left = '-9999px'
          document.body.appendChild(ta)
          ta.select()
          ok = document.execCommand('copy')
          document.body.removeChild(ta)
        }
      } catch {
        ok = false
      }
      setCopied(ok)
      if (ok) {
        timer.current = setTimeout(() => setCopied(false), resetMs)
      }
      return ok
    },
    [resetMs],
  )

  return { copy, copied }
}
