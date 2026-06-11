import mongoose from 'mongoose'

/** Reset the connectDB module cache used by lib/database.ts. */
function clearMongooseCache(): void {
  if (global.mongoose) {
    global.mongoose.conn = null
    global.mongoose.promise = null
  } else {
    global.mongoose = { conn: null, promise: null }
  }
}

/**
 * Connect to the shared in-memory Mongo started in vitest.global-setup.ts.
 * Import application modules that pull in database.ts only AFTER this runs.
 */
export async function setupMongo(): Promise<void> {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not set — is vitest globalSetup configured?')
  }

  clearMongooseCache()

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect()
  }

  const { default: connectDB } = await import('../database')
  await connectDB()

  // Ensure unique indexes exist before integration tests that rely on E11000 races.
  await Promise.all(
    Object.values(mongoose.connection.models).map((model) => model.syncIndexes()),
  )
}

/** Drop worker database and disconnect (shared server keeps running). */
export async function teardownMongo(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase()
    await mongoose.disconnect()
  }
  clearMongooseCache()
}
