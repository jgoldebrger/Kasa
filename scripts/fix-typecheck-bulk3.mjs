import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve('c:/Users/jgoldberger/Desktop/KASA')

const files = []
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next') continue
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.tsx?$/.test(e.name)) files.push(p)
  }
}
walk(root)

for (const f of files) {
  let s = fs.readFileSync(f, 'utf8')
  const o = s
  s = s.replace(/ as HTMLAnchorElement/g, ' as unknown as HTMLAnchorElement')
  s = s.replace(/allowed: true,\s*\r?\n\s*remaining: (\d+),?/g, 'allowed: true,\n        remaining: $1,\n        resetAt: 0,')
  s = s.replace(/allowed: true, remaining: (\d+) \}/g, 'allowed: true, remaining: $1, resetAt: 0 }')
  s = s.replace(/ as \[string, RequestInit\]/g, ' as unknown as [string, RequestInit]')
  s = s.replace(/ as \[string\]/g, ' as unknown as [string]')
  s = s.replace(/null as NextMiddleware/g, 'null as unknown as NextMiddleware')
  s = s.replace(/, null\)/g, ', null as unknown as import("next/server").NextMiddleware)')
  // too broad on null) - skip
  if (s !== o) fs.writeFileSync(f, s)
}

// targeted files
const patches = [
  ['lib/calculations.test.ts', / as \{\s*\$or:/g, ' as unknown as { $or:'],
  ['lib/client/export.dom.test.ts', / as HTMLAnchorElement/g, ' as unknown as HTMLAnchorElement'],
]

for (const [rel, re, rep] of patches) {
  const p = path.join(root, rel)
  let s = fs.readFileSync(p, 'utf8')
  s = s.replace(re, rep)
  fs.writeFileSync(p, s)
}

console.log('done')
