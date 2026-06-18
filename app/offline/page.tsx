'use client'

import { Button, Card } from '@/app/components/ui'

/**
 * Offline fallback page.
 *
 * Served by the service worker when a navigation request fails because
 * the device is offline (and the user hasn't visited the requested
 * page before, so it's not in the cache). Kept dependency-free so we
 * can ship it inside the SW install step without dragging in the
 * provider stack.
 *
 * Opt out of static generation — the root layout resolves auth/DB during
 * build and can hang the export worker on this route.
 */
export const dynamic = 'force-dynamic'

export default function OfflinePage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-app">
      <Card className="max-w-md text-center space-y-4">
        <div className="mx-auto inline-flex items-center justify-center w-12 h-12 rounded-lg bg-accent text-accent-fg font-semibold">
          K
        </div>
        <h1 className="text-2xl font-semibold text-fg">You&apos;re offline</h1>
        <p className="text-sm text-fg-muted">
          We couldn&apos;t reach the network. Recently viewed families, payments, and statements are
          cached — try going back, or reconnect and reload this page.
        </p>
        <Button
          onClick={() => {
            if (typeof window !== 'undefined') window.location.reload()
          }}
        >
          Try again
        </Button>
      </Card>
    </div>
  )
}
