// Fixes lib/route-logic/**/.ts -> lib/route-logic/**/<segment>.ts and updates api-handler re-exports.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOGIC_ROOT = path.join(ROOT, 'lib', 'route-logic')
const HANDLERS_ROOT = path.join(ROOT, 'lib', 'api-handlers')

function logicImportPath(logicFile: string): string {
  const rel = path.relative(path.join(ROOT, 'lib'), logicFile).replace(/\\/g, '/').replace(/\.ts$/, '')
  return `@/lib/${rel}`
}

function findDotTsFiles(dir: string, acc: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) findDotTsFiles(full, acc)
    else if (ent.name === '.ts') acc.push(full)
  }
  return acc
}

function handlerPathForLogic(logicFile: string): string {
  const rel = path.relative(LOGIC_ROOT, logicFile).replace(/\\/g, '/')
  const withoutExt = rel.replace(/\.ts$/, '')
  return path.join(HANDLERS_ROOT, withoutExt, 'handler.ts')
}

function collectExportNames(content: string): string[] {
  const names = new Set<string>()
  for (const m of content.matchAll(/^export const (\w+)\s*=/gm)) names.add(m[1])
  for (const m of content.matchAll(/^export async function (\w+)\s*\(/gm)) names.add(m[1])
  for (const m of content.matchAll(/^export function (\w+)\s*\(/gm)) names.add(m[1])
  return [...names].sort()
}

function main() {
  const broken = findDotTsFiles(LOGIC_ROOT)
  let moved = 0
  for (const brokenFile of broken) {
    const parentDir = path.dirname(brokenFile)
    const segment = path.basename(parentDir)
    const newFile = path.join(path.dirname(parentDir), `${segment}.ts`)
    if (fs.existsSync(newFile)) {
      console.error('Target exists:', newFile)
      continue
    }
    fs.renameSync(brokenFile, newFile)
    const parentName = path.basename(parentDir)
    try {
      fs.rmdirSync(parentDir)
    } catch {
      // directory not empty
    }
    const handlerFile = handlerPathForLogic(newFile)
    if (fs.existsSync(handlerFile)) {
      const content = fs.readFileSync(newFile, 'utf8')
      const exportNames = collectExportNames(content)
      fs.writeFileSync(
        handlerFile,
        `export { ${exportNames.join(', ')} } from '${logicImportPath(newFile)}'\n`,
        'utf8',
      )
    }
    moved++
  }
  console.log(`Fixed ${moved} route-logic path(s).`)
}

main()
