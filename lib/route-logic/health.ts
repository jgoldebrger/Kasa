import mongoose from 'mongoose'
import connectDB from '@/lib/database'
import { handler } from '@/lib/api/handler'

/**
 * GET /api/health
 *
 * Public liveness/readiness probe. Verifies MongoDB connectivity and
 * returns JSON suitable for load balancers, Vercel monitoring, or
 * on-call dashboards. Does not expose tenant data.
 */
export const GET = handler({
  auth: 'public',
  noDb: true,
  name: 'GET /api/health',
  fn: async () => {
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
      status: healthy ? 200 : 503,
      data: {
        status: healthy ? 'ok' : 'unhealthy',
        checks: { mongodb },
        timestamp: new Date().toISOString(),
      },
    }
  },
})
