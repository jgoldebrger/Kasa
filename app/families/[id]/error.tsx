'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

/**
 * Scoped error boundary for the family-detail page. Catches errors in
 * the nested payments / withdrawals / members tabs without unmounting
 * the whole app shell — the user keeps their sidebar and active org
 * while we render a retry surface.
 */
export default function FamilyDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    try {
      Sentry.captureException(error)
    } catch {}
  }, [error])

  return (
    <div className="px-4 py-12 sm:px-6 md:px-8">
      <div className="surface-card mx-auto max-w-lg p-6 text-center">
        <h2 className="text-lg font-semibold text-fg">Couldn’t load this family</h2>
        <p className="mt-2 text-sm text-fg-muted">
          {/* Don't leak `error.message` in production — `digest` is enough
              to correlate with Sentry server-side. */}
          {process.env.NODE_ENV === 'development' && error?.message
            ? error.message
            : 'Something went wrong loading this page.'}
        </p>
        {error?.digest && (
          <p className="mt-1 text-xs text-fg-subtle">Ref: {error.digest}</p>
        )}
        <div className="mt-5 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="focus-ring inline-flex h-9 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg hover:opacity-90"
          >
            Try again
          </button>
          <a
            href="/families"
            className="focus-ring inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium text-fg hover:bg-fg/5"
          >
            Back to families
          </a>
        </div>
      </div>
    </div>
  )
}
