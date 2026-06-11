// One-shot ops script: drop the orphaned `reports` collection left behind
// after the AI/analysis feature was removed. Safe to run multiple times —
// no-ops once the collection is gone.
//
// Usage (PowerShell, from repo root):
//   node scripts/drop-reports-collection.js
//
// The script reads MONGODB_URI from .env.local (same pattern as
// scripts/fix-indexes.js). It will refuse to drop any collection other than
// `reports` and prints what it sees before acting.

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
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set (.env.local missing or unreadable).')
    process.exit(1)
  }

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 })
  const db = mongoose.connection.db

  const collections = await db.listCollections({ name: 'reports' }).toArray()
  if (collections.length === 0) {
    console.log('No `reports` collection found. Nothing to do.')
    await mongoose.disconnect()
    return
  }

  const count = await db.collection('reports').countDocuments()
  console.log(`Found \`reports\` collection with ${count} document(s).`)
  console.log('Dropping…')
  await db.collection('reports').drop()
  console.log('Dropped.')

  await mongoose.disconnect()
}

main().catch((err) => {
  console.error('Failed:', err?.message ?? err)
  process.exit(1)
})
