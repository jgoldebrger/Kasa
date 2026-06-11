// One-shot index cleanup. Drops stale indexes on collections we use.
const path = require('path')
const fs = require('fs')

const envPath = path.join(__dirname, '..', '.env.local')
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n')
  for (const line of lines) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim()
    if (!(k in process.env)) process.env[k] = v
  }
}

const mongoose = require('mongoose')

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 })
  const db = mongoose.connection.db

  // Drop entire stale-index sets. Strategy: drop all non-_id indexes on every
  // affected collection; mongoose will re-create the correct (multi-tenant)
  // ones automatically on next app startup.
  const COLLECTIONS_TO_RESET = [
    'organizations', 'users', 'orgmemberships', 'invites',
    'paymentplans', 'lifecycleevents', 'yearlycalculations',
    'emailconfigs', 'cycleconfigs',
  ]

  for (const collName of COLLECTIONS_TO_RESET) {
    const exists = await db.listCollections({ name: collName }).hasNext()
    if (!exists) {
      console.log(`[skip] ${collName} doesn't exist`)
      continue
    }
    const indexes = await db.collection(collName).indexes()
    console.log(`\n${collName} indexes:`)
    for (const idx of indexes) {
      console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)} unique=${!!idx.unique}`)
    }
    for (const idx of indexes) {
      if (idx.name === '_id_') continue
      console.log(`  DROPPING ${idx.name}`)
      try {
        await db.collection(collName).dropIndex(idx.name)
      } catch (e) {
        console.log(`    (could not drop: ${e.message})`)
      }
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => mongoose.disconnect().catch(() => {}))
