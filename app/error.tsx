'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

import { Button, ButtonLink, Card } from '@/app/components/ui'

/**
 * Root route error boundary. Catches runtime errors thrown in any nested
 * route segment, reports them to Sentry, and gives the user a retry that
 * re-renders the segment without a full reload.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    try {
      Sentry.captureException(error)
    } catch {
      // ignore — Sentry may be disabled
    }
  }, [error])

  return (
    <div className="px-4 py-12 sm:px-6 md:px-8">
      <Card className="mx-auto max-w-lg text-center">
        <h2 className="text-lg font-semibold text-fg">Something went wrong</h2>
        <p className="mt-2 text-sm text-fg-muted">
          {/*
            Never surface `error.message` to end-users in production —
            stack-trace-derived messages can leak file paths, DB
            collection names, and internal IDs. The `digest` rendered
            below is enough for support to correlate against Sentry.
          */}
          {process.env.NODE_ENV === 'development' && error?.message
            ? error.message
            : 'An unexpected error occurred.'}
        </p>
        {error?.digest && <p className="mt-1 text-xs text-fg-subtle">Ref: {error.digest}</p>}
        <div className="mt-5 flex flex-col-reverse justify-center gap-2 sm:flex-row">
          <Button onClick={() => reset()}>Try again</Button>
          <ButtonLink href="/" variant="secondary">
            Go home
          </ButtonLink>
        </div>
      </Card>
    </div>
  )
}
