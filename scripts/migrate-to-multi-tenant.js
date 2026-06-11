/*
 * Migration script: convert Kasa to multi-tenant.
 *
 * What it does (idempotent — safe to re-run):
 *   1. Loads .env.local so we use the same MONGODB_URI as the app.
 *   2. Creates / updates an admin User (hashed password).
 *   3. Creates the Default Organization owned by that admin.
 *   4. Ensures the admin has an "owner" OrgMembership.
 *   5. (Phase 2) Backfills organizationId on every existing document in every
 *      domain collection so legacy data is owned by the Default Organization.
 *
 * Usage:
 *   node scripts/migrate-to-multi-tenant.js \
 *     --email=admin@kasa.local --password=ChangeMe123! --name=Admin
 *
 * Or via env vars:
 *   $env:ADMIN_EMAIL="admin@kasa.local"
 *   $env:ADMIN_PASSWORD="ChangeMe123!"
 *   $env:ADMIN_NAME="Admin"
 *   node scripts/migrate-to-multi-tenant.js
 *
 * Pass --skip-backfill to only create the admin user + default org (Phase 1
 * only). Pass --backfill to force the org-id backfill (Phase 2).
 */

const path = require('path')
const fs = require('fs')

// --- Load .env.local manually so this script has the same MONGODB_URI as the app ---
const envPath = path.join(__dirname, '..', '.env.local')
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

if (!process.env.MONGODB_URI) {
  console.error('ERROR: MONGODB_URI is not set. Add it to .env.local.')
  process.exit(1)
}

// --- Parse CLI args ---
const args = process.argv.slice(2).reduce((acc, raw) => {
  const m = raw.match(/^--([^=]+)(=(.*))?$/)
  if (m) acc[m[1]] = m[3] === undefined ? true : m[3]
  return acc
}, {})

const ADMIN_EMAIL = (args.email || process.env.ADMIN_EMAIL || '').toLowerCase().trim()
const ADMIN_PASSWORD = args.password || process.env.ADMIN_PASSWORD || ''
const ADMIN_NAME = args.name || process.env.ADMIN_NAME || 'Admin'
const SKIP_BACKFILL = !!args['skip-backfill']
const FORCE_BACKFILL = !!args.backfill

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('ERROR: --email and --password are required (or set ADMIN_EMAIL / ADMIN_PASSWORD env vars).')
  console.error('Example: node scripts/migrate-to-multi-tenant.js --email=admin@kasa.local --password=ChangeMe123!')
  process.exit(1)
}

if (ADMIN_PASSWORD.length < 8) {
  console.error('ERROR: Admin password must be at least 8 characters.')
  process.exit(1)
}

// --- Imports that depend on env vars being loaded ---
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')

async function main() {
  console.log('Connecting to MongoDB...')
  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
  })
  console.log('Connected.')

  // We need the models. Mongoose registers them by name once the file is
  // imported. We can't require the TS file directly from a JS script without
  // a build step, so we inline minimal schemas here. They only need to
  // include the field we care about for this migration.
  const { Schema, Types } = mongoose

  const minimal = (extra = {}) =>
    new Schema(
      {
        organizationId: { type: Types.ObjectId, ref: 'Organization', index: true },
        ...extra,
      },
      { strict: false, timestamps: true }
    )

  // Identity-layer schemas (must be complete enough to upsert)
  const User = mongoose.model(
    'User',
    new Schema(
      {
        email: { type: String, required: true, unique: true, lowercase: true, trim: true },
        hashedPassword: { type: String, required: true },
        name: { type: String, required: true },
        lastActiveOrganizationId: { type: Types.ObjectId, ref: 'Organization' },
      },
      { timestamps: true }
    )
  )

  const Organization = mongoose.model(
    'Organization',
    new Schema(
      {
        name: { type: String, required: true },
        slug: { type: String, required: true, unique: true, lowercase: true },
        ownerId: { type: Types.ObjectId, ref: 'User', required: true },
      },
      { timestamps: true }
    )
  )

  const OrgMembership = mongoose.model(
    'OrgMembership',
    new Schema(
      {
        userId: { type: Types.ObjectId, ref: 'User', required: true },
        organizationId: { type: Types.ObjectId, ref: 'Organization', required: true },
        role: { type: String, enum: ['owner', 'admin', 'member'], required: true },
      },
      { timestamps: true }
    )
  )

  // Domain collections (strict:false so we just touch organizationId and leave the rest alone)
  const DOMAIN_COLLECTIONS = [
    'families',
    'familymembers',
    'payments',
    'withdrawals',
    'lifecycleeventpayments',
    'yearlycalculations',
    'statements',
    'tasks',
    'reports',
    'savedpaymentmethods',
    'recurringpayments',
    'emailconfigs',
    'cycleconfigs',
    'paymentplans',
    'lifecycleevents',
  ]

  // ----- 1. Upsert admin user -----
  console.log(`\nUpserting admin user (${ADMIN_EMAIL})...`)
  const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 12)
  let user = await User.findOne({ email: ADMIN_EMAIL })
  if (user) {
    console.log(`  Existing user found (${user._id}). Updating password and name.`)
    user.hashedPassword = hashedPassword
    user.name = ADMIN_NAME
    await user.save()
  } else {
    user = await User.create({ email: ADMIN_EMAIL, hashedPassword, name: ADMIN_NAME })
    console.log(`  Created new user (${user._id}).`)
  }

  // ----- 2. Upsert default organization -----
  console.log('\nUpserting Default Organization...')
  let org = await Organization.findOne({ slug: 'default' })
  if (org) {
    console.log(`  Existing org found (${org._id}: "${org.name}").`)
  } else {
    org = await Organization.create({
      name: 'Default Organization',
      slug: 'default',
      ownerId: user._id,
    })
    console.log(`  Created default org (${org._id}).`)
  }

  // ----- 3. Ensure owner membership -----
  console.log('\nUpserting owner membership...')
  const membership = await OrgMembership.findOneAndUpdate(
    { userId: user._id, organizationId: org._id },
    { userId: user._id, organizationId: org._id, role: 'owner' },
    { upsert: true, new: true }
  )
  console.log(`  Membership: ${membership._id} (role=${membership.role})`)

  // ----- 4. Set lastActiveOrganizationId on the user -----
  if (!user.lastActiveOrganizationId || String(user.lastActiveOrganizationId) !== String(org._id)) {
    user.lastActiveOrganizationId = org._id
    await user.save()
    console.log(`  Set lastActiveOrganizationId on user.`)
  }

  // ----- 5. Backfill organizationId on legacy data (Phase 2) -----
  if (SKIP_BACKFILL) {
    console.log('\n--skip-backfill specified. Done.')
  } else {
    console.log('\nBackfilling organizationId on existing documents...')
    const db = mongoose.connection.db
    let totalUpdated = 0
    for (const collName of DOMAIN_COLLECTIONS) {
      const exists = await db.listCollections({ name: collName }).hasNext()
      if (!exists) {
        console.log(`  [skip] ${collName} (collection does not exist)`)
        continue
      }
      const filter = FORCE_BACKFILL
        ? { $or: [{ organizationId: { $exists: false } }, { organizationId: null }] }
        : { organizationId: { $exists: false } }
      const res = await db.collection(collName).updateMany(filter, {
        $set: { organizationId: org._id },
      })
      console.log(`  ${collName}: ${res.modifiedCount} updated`)
      totalUpdated += res.modifiedCount
    }
    console.log(`\nTotal documents backfilled: ${totalUpdated}`)
  }

  console.log('\nMigration complete.')
  console.log('\nYou can now sign in with:')
  console.log(`  Email:    ${ADMIN_EMAIL}`)
  console.log(`  Password: ${ADMIN_PASSWORD}`)
  console.log('\nOrganization:')
  console.log(`  Name: ${org.name}`)
  console.log(`  Slug: ${org.slug}`)
  console.log(`  ID:   ${org._id}`)
}

main()
  .catch((err) => {
    console.error('\nMIGRATION FAILED:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {})
  })
