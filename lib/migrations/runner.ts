import mongoose from 'mongoose'
import connectDB from '@/lib/database'

export interface Migration {
  id: string
  description: string
  up: () => Promise<void>
}

const MigrationSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    appliedAt: { type: Date, required: true, default: Date.now },
  },
  { collection: 'schema_migrations' },
)

const MigrationModel =
  mongoose.models.SchemaMigration ||
  mongoose.model('SchemaMigration', MigrationSchema, 'schema_migrations')

export async function runMigrations(
  migrations: Migration[],
  opts: { dryRun?: boolean } = {},
): Promise<{ applied: string[]; skipped: string[] }> {
  await connectDB()
  const applied: string[] = []
  const skipped: string[] = []

  for (const migration of migrations) {
    const exists = await MigrationModel.findOne({ id: migration.id }).lean()
    if (exists) {
      skipped.push(migration.id)
      continue
    }
    if (opts.dryRun) {
      console.log(`[migration:dry-run] would apply ${migration.id} — ${migration.description}`)
      applied.push(migration.id)
      continue
    }
    console.log(`[migration] applying ${migration.id} — ${migration.description}`)
    await migration.up()
    await MigrationModel.create({ id: migration.id })
    applied.push(migration.id)
  }

  return { applied, skipped }
}
