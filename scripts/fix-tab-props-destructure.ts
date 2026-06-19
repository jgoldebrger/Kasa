// Shrinks oversized context destructuring to only referenced identifiers.
// Usage: npx tsx scripts/fix-tab-props-destructure.ts
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TARGET_DIR = path.join(ROOT, 'app', 'families', '[id]', '_components')
const EXTRA = [path.join(TARGET_DIR, 'FamilyModals.tsx')]

function walkTsx(dir: string): string[] {
  const out: string[] = []
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isFile() && ent.name.endsWith('.tsx')) out.push(full)
    else if (ent.isDirectory()) out.push(...walkTsx(full))
  }
  return out
}

function fixFile(file: string): boolean {
  let content = fs.readFileSync(file, 'utf8')
  const fnMatch = content.match(
    /function (\w+)\([^)]*\) \{\s*const \{([\s\S]*?)\} = (props|useFamilyDetail\(\))/m,
  )
  if (!fnMatch) return false

  const fnName = fnMatch[1]
  const source = fnMatch[3]
  const fnStart = fnMatch.index!
  const bodyStart = fnStart + fnMatch[0].length
  const fnBody = content.slice(bodyStart)
  const names = fnMatch[2]
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)

  const used = names.filter((name) => {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
    return re.test(fnBody)
  })

  if (used.length === names.length) return false

  const destructure = used.length === 0 ? '' : `  const { ${used.join(', ')} } = ${source}\n`

  const fnHeader = content.slice(fnStart).match(/^function \w+\([^)]*\) \{/)?.[0]
  if (!fnHeader) return false

  const replacement = `${fnHeader}\n${destructure}`
  content = content.slice(0, fnStart) + replacement + fnBody
  fs.writeFileSync(file, content, 'utf8')
  console.log(`${path.relative(ROOT, file)}: ${names.length} -> ${used.length} (${fnName})`)
  return true
}

function main() {
  const files = [...walkTsx(TARGET_DIR), ...EXTRA.filter((f) => fs.existsSync(f))]
  let fixed = 0
  let pass = 0
  do {
    pass++
    fixed = 0
    for (const file of files) {
      if (fixFile(file)) fixed++
    }
  } while (fixed > 0 && pass < 5)
  console.log(`Done after ${pass} pass(es).`)
}

main()
