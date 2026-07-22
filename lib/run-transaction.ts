import mongoose from 'mongoose'
import connectDB from '@/lib/database'

/**
 * Run a callback inside a MongoDB transaction when the deployment supports it
 * (replica set / Atlas). Falls back to running without a session in dev/test
 * when transactions are unavailable.
 */
export async function runTransaction<T>(
  fn: (session: mongoose.ClientSession | null) => Promise<T>,
): Promise<T> {
  await connectDB()
  const session = await mongoose.startSession()
  try {
    let result!: T
    await session.withTransaction(async () => {
      result = await fn(session)
    })
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (
      message.includes('Transaction numbers are only allowed on a replica set') ||
      message.includes('replica set member')
    ) {
      return fn(null)
    }
    throw err
  } finally {
    await session.endSession()
  }
}
