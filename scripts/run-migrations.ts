#!/usr/bin/env npx tsx
/**
 * Apply idempotent schema/data migrations tracked in `schema_migrations`.
 * Usage: npx tsx scripts/run-migrations.ts [--dry-run]
 */
import { config } from 'dotenv'
import mongoose from 'mongoose'
import { migrations } from '../lib/migrations'
import { runMigrations } from '../lib/migrations/runner'

config({ path: '.env.local' })

async function main(): Promise<void> {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is required — set it in .env.local')
    process.exit(1)
  }

  const dryRun = process.argv.includes('--dry-run')
  const { applied, skipped } = await runMigrations(migrations, { dryRun })

  await mongoose.disconnect()
  console.log(
    `[migrate] Done — applied: ${applied.length}, skipped: ${skipped.length}${dryRun ? ' (dry-run)' : ''}`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
