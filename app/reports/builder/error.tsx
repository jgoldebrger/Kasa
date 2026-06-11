'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

export default function ReportsBuilderError({
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
        <h2 className="text-lg font-semibold text-fg">Report failed to render</h2>
        <p className="mt-2 text-sm text-fg-muted">
          {process.env.NODE_ENV === 'development' && error?.message
            ? error.message
            : 'Something went wrong building this report. Try tweaking the filters or refreshing.'}
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
            href="/reports"
            className="focus-ring inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium text-fg hover:bg-fg/5"
          >
            Back to reports
          </a>
        </div>
      </div>
    </div>
  )
}
