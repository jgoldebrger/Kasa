'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/app/components/ui'
import {
  acceptCookieNotice,
  SESSION_COOKIES,
  shouldShowCookieNotice,
} from '@/lib/legal/cookie-notice'

/**
 * Bottom banner explaining strictly-necessary session cookies.
 * Shown once per browser until the user acknowledges.
 */
export default function CookieNotice() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setVisible(shouldShowCookieNotice())
  }, [])

  if (!visible) return null

  function handleAccept() {
    acceptCookieNotice()
    setVisible(false)
  }

  return (
    <div
      role="dialog"
      aria-labelledby="cookie-notice-title"
      aria-describedby="cookie-notice-desc"
      className="fixed inset-x-0 bottom-0 z-[60] p-4 sm:p-6 pointer-events-none"
    >
      <div className="pointer-events-auto mx-auto max-w-3xl surface-card border border-border shadow-2xl rounded-lg p-4 sm:p-5">
        <h2 id="cookie-notice-title" className="text-sm font-semibold text-fg mb-2">
          Cookies &amp; privacy
        </h2>
        <p id="cookie-notice-desc" className="text-sm text-fg-muted leading-relaxed mb-3">
          Kasa uses a small number of strictly necessary cookies to keep you signed in,
          remember your workspace, and apply your language preference. We do not use
          advertising or third-party tracking cookies.
        </p>
        <ul className="text-xs text-fg-muted space-y-1 mb-4">
          {SESSION_COOKIES.map((cookie) => (
            <li key={cookie.name}>
              <span className="font-mono text-fg">{cookie.name}</span>
              {' — '}
              {cookie.purpose}
            </li>
          ))}
        </ul>
        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2">
          <Link
            href="/privacy"
            className="focus-ring text-sm text-accent hover:underline text-center sm:text-start"
          >
            Privacy Policy
          </Link>
          <Button size="sm" onClick={handleAccept}>
            Got it
          </Button>
        </div>
      </div>
    </div>
  )
}
