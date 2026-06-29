#!/usr/bin/env npx tsx
/**
 * Seed the sales demo sandbox org (idempotent).
 *
 * Usage: npx tsx scripts/seed-demo-org.ts [ownerUserId]
 *
 * When ownerUserId is omitted, uses the first platform admin user in the DB.
 */

import mongoose from 'mongoose'
import connectDB from '@/lib/database'
import { User } from '@/lib/models'
import { seedDemoSandboxOrg, DEMO_ORG_SLUG } from '@/lib/demo-org-seed'
import { isPlatformAdminEmail } from '@/lib/platform-admin'

async function main() {
  await connectDB()

  let ownerUserId = process.argv[2]?.trim()
  if (!ownerUserId) {
    const admins = await User.find()
      .select('email _id')
      .lean<Array<{ _id: unknown; email?: string }>>()
    const admin = admins.find((u) => u.email && isPlatformAdminEmail(u.email))
    if (!admin) {
      console.error('No platform admin user found. Pass ownerUserId as the first argument.')
      process.exit(1)
    }
    ownerUserId = String(admin._id)
    console.log(`Using platform admin ${admin.email} as demo org owner.`)
  }

  const result = await seedDemoSandboxOrg(ownerUserId)
  console.log(
    result.created
      ? `Created demo org "${result.name}" (${DEMO_ORG_SLUG})`
      : `Demo org already exists (${DEMO_ORG_SLUG})`,
  )
  console.log(`  organizationId: ${result.organizationId}`)
  console.log(`  families: ${result.familyCount}, payments: ${result.paymentCount}`)
  await mongoose.disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
