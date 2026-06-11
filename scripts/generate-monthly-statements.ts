/**
 * CLI wrapper around `lib/scheduler.generateMonthlyStatements`.
 *
 * Prefer the cron job (`POST /api/jobs/generate-monthly-statements`) for
 * production — it respects org automation settings, Hebrew/Gregorian
 * calendars, refund netting, and idempotent refresh.
 *
 * Usage:
 *   ORGANIZATION_ID=<mongoId> npx tsx scripts/generate-monthly-statements.ts [year] [month]
 */

import { config } from 'dotenv'
import { generateMonthlyStatements } from '../lib/scheduler'

config({ path: '.env.local' })

async function main() {
  const organizationId = process.env.ORGANIZATION_ID?.trim()
  if (!organizationId) {
    console.error('ORGANIZATION_ID env var is required')
    process.exit(1)
  }
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI env var is required (set it in .env.local)')
    process.exit(1)
  }

  const year = process.argv[2] ? parseInt(process.argv[2], 10) : undefined
  const month = process.argv[3] ? parseInt(process.argv[3], 10) : undefined

  const result = await generateMonthlyStatements(organizationId, year, month)
  console.log(JSON.stringify(result, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
