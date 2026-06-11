#!/usr/bin/env npx tsx
/**
 * Insert verifyApiCsrf() at the start of legacy route handlers that lack it.
 */
import fs from 'fs'
import path from 'path'

const API_DIR = path.join(__dirname, '..', 'app', 'api')
const IMPORT_LINE = "import { verifyApiCsrf } from '@/lib/csrf'"
const GUARD = `    const csrfBlock = verifyApiCsrf(request)
    if (csrfBlock) return csrfBlock
`

const SKIP_PATH_PARTS = ['/stripe/webhook', '/auth/[...nextauth]']

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    if (fs.statSync(full).isDirectory()) out.push(...walk(full))
    else if (name === 'route.ts') out.push(full)
  }
  return out
}

function needsGuard(content: string): boolean {
  if (content.includes('verifyApiCsrf')) return false
  if (!/export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/.test(content)) return false
  if (/export\s+const\s+(POST|PUT|PATCH|DELETE)\s*=\s*handler/.test(content)) return false
  return true
}

function patchFile(file: string): boolean {
  let content = fs.readFileSync(file, 'utf8')
  if (!needsGuard(content)) return false

  const rel = file.replace(/\\/g, '/')
  if (SKIP_PATH_PARTS.some((p) => rel.includes(p))) return false

  if (!content.includes(IMPORT_LINE)) {
    const importMatch = content.match(/^import .+$/m)
    if (importMatch) {
      const idx = content.lastIndexOf(importMatch[0])
      const lineEnd = content.indexOf('\n', idx)
      content = content.slice(0, lineEnd + 1) + IMPORT_LINE + '\n' + content.slice(lineEnd + 1)
    } else {
      content = IMPORT_LINE + '\n' + content
    }
  }

  const fnRe =
    /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\([^)]*\)\s*\{(\s*try\s*\{)?/g
  let changed = false
  content = content.replace(fnRe, (match, _method, tryBlock) => {
    if (match.includes('verifyApiCsrf')) return match
    changed = true
    if (tryBlock) {
      return match + '\n' + GUARD
    }
    return match + '\n' + GUARD.replace(/^    /gm, '  ')
  })

  if (changed) {
    fs.writeFileSync(file, content, 'utf8')
    return true
  }
  return false
}

function main(): void {
  const files = walk(API_DIR)
  let patched = 0
  for (const f of files) {
    if (patchFile(f)) {
      patched++
      console.log('patched', path.relative(API_DIR, f))
    }
  }
  console.log(`[csrf-guard] Patched ${patched} files`)
}

main()
