import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve('c:/Users/jgoldberger/Desktop/KASA')
const cast = ".lean() as import('@/lib/test/type-helpers').LeanDoc | null"
const plain = '.lean()'

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.next') continue
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, out)
    else if (/\.ts$/.test(ent.name)) out.push(p)
  }
  return out
}

let n = 0
for (const f of walk(path.join(root, 'lib'))) {
  if (/\.(test|integration\.test|unit\.test|dom\.test)\.ts$/.test(f)) continue
  if (!f.includes('route-logic') && !f.endsWith('recycle-bin.ts') && !f.endsWith('task-helpers.ts')) continue
  let s = fs.readFileSync(f, 'utf8')
  if (!s.includes(cast)) continue
  s = s.split(cast).join(plain)
  fs.writeFileSync(f, s, 'utf8')
  n++
  console.log('reverted', path.relative(root, f))
}
console.log('reverted files:', n)
