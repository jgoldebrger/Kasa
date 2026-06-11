import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve('c:/Users/jgoldberger/Desktop/KASA')

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.next') continue
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(ent.name)) out.push(p)
  }
  return out
}

function ensureImport(s, spec) {
  if (s.includes(spec)) return s
  const m = s.match(/^import .+ from .+\n/m)
  if (m) {
    const idx = m.index + m[0].length
    return s.slice(0, idx) + spec + '\n' + s.slice(idx)
  }
  return spec + '\n' + s
}

function patchFile(file) {
  let s = fs.readFileSync(file, 'utf8')
  const orig = s

  s = s.replace(/allowed: false,\s*\r?\n\s*remaining: (\d+),?/g, 'allowed: false,\n        remaining: $1,\n        resetAt: 0,')

  if (/\.(test|integration\.test|unit\.test|dom\.test)\.tsx?$/.test(file)) {
    if (/process\.env\.NODE_ENV\s*=/.test(s)) {
      s = s.replace(/process\.env\.NODE_ENV\s*=\s*([^;\n]+)/g, 'setNodeEnv($1)')
      s = ensureImport(s, "import { setNodeEnv } from '@/lib/test/type-helpers'")
    }
  }

  s = s.replace(/\) as HTMLAnchorElement/g, ') as unknown as HTMLAnchorElement')

  if (s !== orig) {
    fs.writeFileSync(file, s, 'utf8')
    return true
  }
  return false
}

let n = 0
for (const f of walk(root)) {
  if (patchFile(f)) {
    n++
    console.log('patched', path.relative(root, f))
  }
}
console.log('patched', n)
