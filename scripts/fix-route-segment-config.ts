// Hoist route segment config into app/api/**/route.ts for Next.js 16+.
// Usage: npx tsx scripts/fix-route-segment-config.ts
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SEGMENT_CONFIG = new Set([
  'dynamic',
  'runtime',
  'revalidate',
  'fetchCache',
  'preferredRegion',
  'maxDuration',
])

const SEGMENT_DEFAULTS: Record<string, string> = {
  dynamic: "'force-dynamic'",
  runtime: "'nodejs'",
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(full, acc)
    else if (ent.name === 'route.ts') acc.push(full)
  }
  return acc
}

function parseReexport(line: string): { names: string[]; from: string } | null {
  const m = line.match(/^export\s*\{\s*([^}]+)\s*\}\s*from\s*['"]([^'"]+)['"]\s*;?\s*$/)
  if (!m) return null
  const names = m[1]
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
  return { names, from: m[2] }
}

function existingSegmentLines(content: string): Set<string> {
  const found = new Set<string>()
  for (const name of SEGMENT_CONFIG) {
    if (new RegExp(`^export const ${name}\\s*=`).test(content)) found.add(name)
  }
  return found
}

function main() {
  const routes = walk(path.join(ROOT, 'app', 'api'))
  let updated = 0

  for (const routeFile of routes) {
    const content = fs.readFileSync(routeFile, 'utf8')
    const lines = content.split(/\r?\n/)
    const reexportLine = lines.find((l) => l.trim().startsWith('export {') && l.includes(' from '))
    if (!reexportLine) continue

    const parsed = parseReexport(reexportLine.trim())
    if (!parsed) continue

    const segmentInReexport = parsed.names.filter((n) => SEGMENT_CONFIG.has(n))
    if (segmentInReexport.length === 0) continue

    const already = existingSegmentLines(content)
    const toHoist = segmentInReexport.filter((n) => !already.has(n))
    const handlerExports = parsed.names.filter((n) => !SEGMENT_CONFIG.has(n))
    if (handlerExports.length === 0) {
      console.warn('Skipping route with only segment config in re-export:', routeFile)
      continue
    }

    const hoistLines = toHoist.map((name) => {
      const value = SEGMENT_DEFAULTS[name] ?? `'force-dynamic'`
      return `export const ${name} = ${value}`
    })

    const otherLines = lines.filter((l) => l.trim() !== reexportLine.trim())
    const reexport = `export { ${handlerExports.join(', ')} } from '${parsed.from}'`
    const body = [
      ...hoistLines,
      '',
      reexport,
      '',
      ...otherLines.filter((l) => l.trim().length > 0),
      '',
    ].join('\n')
    fs.writeFileSync(routeFile, body, 'utf8')
    updated++
  }

  // Stripe webhook: segment config lives in handler chain but not in route re-export.
  const webhookRoute = path.join(ROOT, 'app', 'api', 'stripe', 'webhook', 'route.ts')
  const webhookContent = fs.readFileSync(webhookRoute, 'utf8')
  if (!webhookContent.includes('export const dynamic')) {
    fs.writeFileSync(
      webhookRoute,
      `export const dynamic = 'force-dynamic'\nexport const runtime = 'nodejs'\n\n${webhookContent.trim()}\n`,
      'utf8',
    )
    updated++
  }

  console.log(`Updated ${updated} route file(s).`)
}

main()
