import { MongoMemoryServer } from 'mongodb-memory-server'

declare global {
  // eslint-disable-next-line no-var
  var __KASA_MONGO_MEMORY__: MongoMemoryServer | undefined
  // eslint-disable-next-line no-var
  var __KASA_MONGO_SETUP_REFS__: number | undefined
}

export async function setup() {
  const refs = (globalThis.__KASA_MONGO_SETUP_REFS__ ?? 0) + 1
  globalThis.__KASA_MONGO_SETUP_REFS__ = refs

  if (globalThis.__KASA_MONGO_MEMORY__) {
    process.env.MONGODB_URI = globalThis.__KASA_MONGO_MEMORY__.getUri()
    return
  }

  const mongo = await MongoMemoryServer.create({
    instance: { launchTimeout: 120_000 },
  })
  process.env.MONGODB_URI = mongo.getUri()
  globalThis.__KASA_MONGO_MEMORY__ = mongo
}

export async function teardown() {
  const refs = Math.max(0, (globalThis.__KASA_MONGO_SETUP_REFS__ ?? 1) - 1)
  globalThis.__KASA_MONGO_SETUP_REFS__ = refs

  if (refs > 0) return

  try {
    const m = await import('mongoose')
    const mg = (m as { default?: typeof import('mongoose') }).default ?? m
    if (mg.connection?.readyState !== 0) {
      await mg.disconnect()
    }
  } catch {
    // mongoose may not be loaded in every worker
  }

  await globalThis.__KASA_MONGO_MEMORY__?.stop()
  globalThis.__KASA_MONGO_MEMORY__ = undefined
}
