/**
 * Encrypt legacy plaintext SMTP passwords and 2FA secrets at rest.
 *
 * Usage:
 *   npx tsx scripts/encrypt-legacy-secrets.ts [--dry-run]
 *
 * Requires MONGODB_URI and ENCRYPTION_KEY (or NEXTAUTH_SECRET in dev).
 */

import { config } from 'dotenv'
import mongoose from 'mongoose'
import connectDB from '../lib/database'
import { migrateLegacySecrets } from '../lib/migrations/encrypt-legacy-secrets'

config({ path: '.env.local' })

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI env var is required (set it in .env.local)')
    process.exit(1)
  }

  if (!process.env.ENCRYPTION_KEY && !process.env.NEXTAUTH_SECRET) {
    console.error(
      'ENCRYPTION_KEY (or NEXTAUTH_SECRET in dev) is required before encrypting secrets.',
    )
    process.exit(1)
  }

  await connectDB()

  const result = await migrateLegacySecrets({ dryRun })

  console.log(
    JSON.stringify(
      {
        dryRun: result.dryRun,
        emailConfigs: result.emailConfigs,
        users: result.users,
      },
      null,
      2,
    ),
  )

  await mongoose.disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
