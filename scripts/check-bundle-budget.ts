#!/usr/bin/env npx tsx
/**
 * Fail CI when any single client JS chunk in `.next/static/chunks` exceeds budget.
 *
 * Thresholds are intentionally generous so routine dependency growth does not flake CI.
 * Tighten MAX_CHUNK_BYTES after a deliberate bundle diet, or add per-chunk overrides.
 *
 * Raw (uncompressed) size is used — no gzip — so the check is fast and deterministic.
 * Next may emit hashed chunk names; we scan the whole directory each build.
 */
import fs from 'fs'
import path from 'path'

const ROOT = path.join(__dirname, '..')
const NEXT_DIR = path.join(ROOT, '.next')
const BUILD_ID_FILE = path.join(NEXT_DIR, 'BUILD_ID')
const CHUNKS_DIR = path.join(NEXT_DIR, 'static', 'chunks')

/** Per-chunk ceiling (raw bytes). ~1.5 MB leaves headroom above typical app chunks. */
const MAX_CHUNK_BYTES = 1_572_864

/** Sum of all client chunks; catches many medium-sized regressions at once. */
const MAX_TOTAL_BYTES = 12_582_912

/** Dev/turbopack artifacts that appear under .next after `next dev` — not shipped in prod. */
const DEV_CHUNK_RE = /(?:next-devtools|turbopack|hmr-client|_ssgManifest|_buildManifest)/i

function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`
}

function main(): void {
  if (!fs.existsSync(BUILD_ID_FILE)) {
    console.error(
      `Missing ${path.relative(ROOT, BUILD_ID_FILE)} — run "npm run build" (production) before check:bundle.`,
    )
    console.error(
      'Dev-server output under .next is not checked (it includes turbopack/devtools chunks).',
    )
    process.exit(1)
  }

  if (!fs.existsSync(CHUNKS_DIR)) {
    console.error(`Missing build output: ${CHUNKS_DIR}\nRun "npm run build" first.`)
    process.exit(1)
  }

  const jsFiles = fs
    .readdirSync(CHUNKS_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.js') && !DEV_CHUNK_RE.test(e.name))
    .map((e) => {
      const filePath = path.join(CHUNKS_DIR, e.name)
      const size = fs.statSync(filePath).size
      return { name: e.name, filePath, size }
    })
    .sort((a, b) => b.size - a.size)

  if (jsFiles.length === 0) {
    console.error(`No .js chunks found under ${CHUNKS_DIR}`)
    process.exit(1)
  }

  const overBudget = jsFiles.filter((f) => f.size > MAX_CHUNK_BYTES)
  const totalBytes = jsFiles.reduce((sum, f) => sum + f.size, 0)

  const top = jsFiles.slice(0, 8)
  console.log(`Scanned ${jsFiles.length} client chunks in .next/static/chunks`)
  console.log(`Total raw JS: ${formatKb(totalBytes)} (budget ${formatKb(MAX_TOTAL_BYTES)})`)
  console.log('Largest chunks:')
  for (const f of top) {
    const flag = f.size > MAX_CHUNK_BYTES ? ' OVER' : ''
    console.log(`  ${f.name}: ${formatKb(f.size)}${flag}`)
  }

  let failed = false

  if (overBudget.length > 0) {
    failed = true
    console.error(
      `\n${overBudget.length} chunk(s) exceed per-chunk budget of ${formatKb(MAX_CHUNK_BYTES)}:`,
    )
    for (const f of overBudget) {
      console.error(`  ${f.name}: ${formatKb(f.size)}`)
    }
  }

  if (totalBytes > MAX_TOTAL_BYTES) {
    failed = true
    console.error(
      `\nTotal client JS ${formatKb(totalBytes)} exceeds budget ${formatKb(MAX_TOTAL_BYTES)}`,
    )
  }

  if (failed) {
    process.exit(1)
  }

  console.log('\nBundle budget check passed.')
}

main()
