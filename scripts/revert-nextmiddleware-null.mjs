import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve('c:/Users/jgoldberger/Desktop/KASA')
const bad = 'null as unknown as import("next/server").NextMiddleware'
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
let n = 0
for (const f of files) {
  let s = fs.readFileSync(f, 'utf8')
  if (!s.includes(bad)) continue
  s = s.split(bad).join('null')
  fs.writeFileSync(f, s)
  n++
  console.log('fixed', path.relative(root, f))
}
console.log('count', n)
