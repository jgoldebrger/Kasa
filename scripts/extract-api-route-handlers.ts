// Moves app/api route.ts implementations to lib/api-handlers so route files
// become thin re-exports. Usage: npx tsx scripts/extract-api-route-handlers.ts
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function isThinReexport(content: string): boolean {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('//'))
  if (lines.length === 0) return true
  return lines.every((l) => /^export\s/.test(l) && l.includes(' from '))
}

function collectExportNames(content: string): string[] {
  const names = new Set<string>()
  for (const m of content.matchAll(/^export const (\w+)\s*=/gm)) {
    names.add(m[1])
  }
  for (const m of content.matchAll(/^export async function (\w+)\s*\(/gm)) {
    names.add(m[1])
  }
  return [...names].sort()
}

function routeToHandlerPath(routeFile: string): string {
  const rel = path.relative(path.join(ROOT, 'app', 'api'), routeFile)
  const withoutRoute = rel.replace(/route\.ts$/i, 'handler.ts')
  return path.join(ROOT, 'lib', 'api-handlers', withoutRoute)
}

function handlerImportPath(handlerFile: string): string {
  const rel = path
    .relative(path.join(ROOT, 'lib'), handlerFile)
    .replace(/\\/g, '/')
    .replace(/\.ts$/, '')
  return `@/lib/${rel}`
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(full, acc)
    else if (ent.name === 'route.ts') acc.push(full)
  }
  return acc
}

function main() {
  const apiRoot = path.join(ROOT, 'app', 'api')
  const routes = walk(apiRoot)
  let extracted = 0
  let skipped = 0

  for (const routeFile of routes) {
    const content = fs.readFileSync(routeFile, 'utf8')
    if (isThinReexport(content)) {
      skipped++
      continue
    }

    const handlerFile = routeToHandlerPath(routeFile)
    fs.mkdirSync(path.dirname(handlerFile), { recursive: true })
    fs.writeFileSync(handlerFile, content, 'utf8')

    const exportNames = collectExportNames(content)
    if (exportNames.length === 0) {
      console.warn('No exports found:', routeFile)
      continue
    }

    const importFrom = handlerImportPath(handlerFile)
    const routeBody = `export { ${exportNames.join(', ')} } from '${importFrom}'\n`
    fs.writeFileSync(routeFile, routeBody, 'utf8')
    extracted++
  }

  console.log(`Extracted ${extracted} route(s), skipped ${skipped} thin re-export(s).`)
}

main()
