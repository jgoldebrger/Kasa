/**
 * Boots an ephemeral MongoDB + seeds E2E data + starts Next.js for Playwright.
 */
import { spawn, type ChildProcess } from 'child_process'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { E2E_SECRETS, E2E_USER, seedE2eDatabase } from './seed'

const PORT = process.env.E2E_PORT || '3000'
const BASE_URL = `http://127.0.0.1:${PORT}`
/** Default 0 for fast Playwright runs; set E2E_BULK_FAMILIES=1100 for large-org.spec.ts */
const BULK_FAMILIES = Number(process.env.E2E_BULK_FAMILIES ?? '0')

let nextProc: ChildProcess | null = null
let mongod: MongoMemoryServer | null = null

async function shutdown(code = 0) {
  if (nextProc && !nextProc.killed) {
    nextProc.kill('SIGTERM')
  }
  if (mongod) {
    await mongod.stop().catch(() => {})
    mongod = null
  }
  process.exit(code)
}

process.on('SIGINT', () => void shutdown(0))
process.on('SIGTERM', () => void shutdown(0))

async function main() {
  console.log('[e2e] Starting MongoMemoryServer…')
  mongod = await MongoMemoryServer.create()
  const uri = mongod.getUri()

  console.log(`[e2e] Seeding database (${BULK_FAMILIES} bulk families in Alpha org)…`)
  await seedE2eDatabase(uri, { bulkFamilyCount: BULK_FAMILIES })

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MONGODB_URI: uri,
    NEXTAUTH_URL: BASE_URL,
    AUTH_SECRET: E2E_SECRETS.auth,
    NEXTAUTH_SECRET: E2E_SECRETS.auth,
    ENCRYPTION_KEY: E2E_SECRETS.encryption,
    NODE_ENV: 'development',
    PLATFORM_ADMIN_EMAILS: E2E_USER.email,
  }

  console.log(`[e2e] Starting Next.js on ${BASE_URL}…`)
  nextProc = spawn('npx', ['next', 'dev', '-p', PORT, '--hostname', '127.0.0.1', '--turbo'], {
    env,
    stdio: 'inherit',
    shell: true,
  })

  nextProc.on('exit', (code) => {
    console.log(`[e2e] Next.js exited with code ${code ?? 0}`)
    void shutdown(code ?? 0)
  })
}

main().catch((err) => {
  console.error('[e2e] Failed to start dev server:', err)
  void shutdown(1)
})
