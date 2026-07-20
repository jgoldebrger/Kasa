import mongoose from 'mongoose'
import connectDB from '@/lib/database'
import { handler } from '@/lib/api/handler'

async function checkMongo(): Promise<'ok' | 'error'> {
  try {
    await connectDB()
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.db!.admin().ping()
      return 'ok'
    }
  } catch {
    // fall through
  }
  return 'error'
}

/**
 * GET /api/health
 *
 * Combined probe (back-compat for existing uptime monitors).
 * Prefer /api/health/livez (process up) and /api/health/readyz (Mongo ready)
 * when configuring load balancers.
 */
export const GET = handler({
  auth: 'public',
  noDb: true,
  name: 'GET /api/health',
  fn: async () => {
    const mongodb = await checkMongo()
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

/**
 * GET /api/health/livez — process liveness (no dependency checks).
 */
export const GET_LIVEZ = handler({
  auth: 'public',
  noDb: true,
  name: 'GET /api/health/livez',
  fn: async () => ({
    status: 200,
    data: {
      status: 'ok',
      checks: { process: 'ok' },
      timestamp: new Date().toISOString(),
    },
  }),
})

/**
 * GET /api/health/readyz — readiness (MongoDB reachable).
 */
export const GET_READYZ = handler({
  auth: 'public',
  noDb: true,
  name: 'GET /api/health/readyz',
  fn: async () => {
    const mongodb = await checkMongo()
    const ready = mongodb === 'ok'
    return {
      status: ready ? 200 : 503,
      data: {
        status: ready ? 'ok' : 'not_ready',
        checks: { mongodb },
        timestamp: new Date().toISOString(),
      },
    }
  },
})
