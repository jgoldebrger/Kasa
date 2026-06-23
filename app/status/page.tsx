import type { Metadata } from 'next'
import Link from 'next/link'
import { Card } from '@/app/components/ui'
import connectDB from '@/lib/database'
import mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'System Status — Kasa',
  description: 'Kasa platform availability and health checks.',
  robots: { index: true, follow: true },
}

async function fetchHealth(): Promise<{
  status: 'ok' | 'unhealthy'
  checks: { mongodb: 'ok' | 'error' }
  timestamp: string
}> {
  let mongodb: 'ok' | 'error' = 'error'
  try {
    await connectDB()
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.db!.admin().ping()
      mongodb = 'ok'
    }
  } catch {
    mongodb = 'error'
  }
  const healthy = mongodb === 'ok'
  return {
    status: healthy ? 'ok' : 'unhealthy',
    checks: { mongodb },
    timestamp: new Date().toISOString(),
  }
}

export default async function StatusPage() {
  const health = await fetchHealth()
  const allOk = health.status === 'ok'

  return (
    <div className="min-h-screen bg-app flex items-center justify-center p-6">
      <Card className="max-w-md w-full p-8 space-y-6 text-center">
        <div className="mx-auto inline-flex items-center justify-center w-12 h-12 rounded-lg bg-accent text-accent-fg font-semibold">
          K
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-fg">Kasa system status</h1>
          <p className="text-sm text-fg-muted mt-2">
            Live health check for the Kasa platform. Point uptime monitors at{' '}
            <code className="text-xs font-mono">/api/health</code>.
          </p>
        </div>

        <div
          className={`rounded-lg border px-4 py-3 ${
            allOk
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300'
          }`}
        >
          <p className="font-semibold text-lg">{allOk ? 'All systems operational' : 'Degraded'}</p>
          <p className="text-sm mt-1 opacity-90">
            MongoDB: {health.checks.mongodb === 'ok' ? 'connected' : 'unavailable'}
          </p>
        </div>

        <p className="text-xs text-fg-subtle">
          Last checked {new Date(health.timestamp).toLocaleString()}
        </p>

        <p className="text-sm">
          <Link href="/trust" className="text-accent hover:underline">
            Trust &amp; security
          </Link>
          {' · '}
          <Link href="/welcome" className="text-accent hover:underline">
            Kasa home
          </Link>
        </p>
      </Card>
    </div>
  )
}
