#!/usr/bin/env npx tsx
/**
 * Sync Mongoose schema indexes to MongoDB. Run after deploy or schema changes.
 * Usage: npx tsx scripts/sync-indexes.ts
 */
import { config } from 'dotenv'
import mongoose from 'mongoose'
import connectDB from '../lib/database'
import * as models from '../lib/models'

config({ path: '.env.local' })

async function main(): Promise<void> {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is required — set it in .env.local')
    process.exit(1)
  }

  await connectDB()

  const modelNames = Object.keys(models).filter(
    (k) => k !== 'default' && (models as Record<string, unknown>)[k],
  )

  const results: Array<{ model: string; ok: boolean; error?: string }> = []

  for (const name of modelNames.sort()) {
    const model = (models as Record<string, { syncIndexes?: () => Promise<string[]> }>)[name]
    if (!model?.syncIndexes) continue
    try {
      const created = await model.syncIndexes()
      console.log(`[sync-indexes] ${name}: ${created.length ? created.join(', ') : 'up to date'}`)
      results.push({ model: name, ok: true })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      console.error(`[sync-indexes] ${name}: FAILED — ${error}`)
      results.push({ model: name, ok: false, error })
    }
  }

  const failed = results.filter((r) => !r.ok)
  await mongoose.disconnect()

  if (failed.length > 0) {
    console.error(`[sync-indexes] ${failed.length} model(s) failed`)
    process.exit(1)
  }

  console.log(`[sync-indexes] Done — ${results.length} models checked`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
