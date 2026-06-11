// Moves lib/api-handlers/**/handler.ts implementations to lib/route-logic/**
// and leaves handlers as re-exports (logic covered under lib/ at 100%).
// Usage: npx tsx scripts/extract-handler-logic-to-lib.ts
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function isThinReexport(content: string): boolean {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('//'))
  return lines.every((l) => /^export\s/.test(l) && l.includes(' from '))
}

function collectExportNames(content: string): string[] {
  const names = new Set<string>()
  for (const m of content.matchAll(/^export const (\w+)\s*=/gm)) names.add(m[1])
  for (const m of content.matchAll(/^export async function (\w+)\s*\(/gm)) names.add(m[1])
  for (const m of content.matchAll(/^export function (\w+)\s*\(/gm)) names.add(m[1])
  return [...names].sort()
}

function handlerToLogicPath(handlerFile: string): string {
  const rel = path.relative(path.join(ROOT, 'lib', 'api-handlers'), handlerFile)
  return path.join(ROOT, 'lib', 'route-logic', rel.replace(/[/\\]handler\.ts$/i, '.ts'))
}

function logicImportPath(logicFile: string): string {
  const rel = path.relative(path.join(ROOT, 'lib'), logicFile).replace(/\\/g, '/').replace(/\.ts$/, '')
  return `@/lib/${rel}`
}

function walk(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(full, acc)
    else if (ent.name === 'handler.ts') acc.push(full)
  }
  return acc
}

function main() {
  const handlersRoot = path.join(ROOT, 'lib', 'api-handlers')
  const handlers = walk(handlersRoot)
  let moved = 0
  let skipped = 0

  for (const handlerFile of handlers) {
    const content = fs.readFileSync(handlerFile, 'utf8')
    if (isThinReexport(content)) {
      skipped++
      continue
    }

    const logicFile = handlerToLogicPath(handlerFile)
    if (fs.existsSync(logicFile)) {
      console.warn('Logic file exists, skip:', logicFile)
      skipped++
      continue
    }

    fs.mkdirSync(path.dirname(logicFile), { recursive: true })
    fs.writeFileSync(logicFile, content, 'utf8')

    const exportNames = collectExportNames(content)
    const importFrom = logicImportPath(logicFile)
    fs.writeFileSync(
      handlerFile,
      `export { ${exportNames.join(', ')} } from '${importFrom}'\n`,
      'utf8',
    )
    moved++
  }

  console.log(`Moved ${moved} handler(s) to lib/route-logic/, skipped ${skipped}.`)
}

main()
