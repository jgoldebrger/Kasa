import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve('c:/Users/jgoldberger/Desktop/KASA')
const cast = ".lean() as import('@/lib/test/type-helpers').LeanDoc | null"

function isTestFile(f) {
  return /\.(test|integration\.test|unit\.test|dom\.test|smoke\.test)\.tsx?$/.test(f)
}

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.next') continue
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(ent.name)) out.push(p)
  }
  return out
}

function patchFile(file) {
  let s = fs.readFileSync(file, 'utf8')
  const orig = s
  s = s.replace(/new Stripe\((['"])sk_test\1\) as \{/g, "new Stripe($1sk_test$1) as unknown as {")
  s = s.replace(/\{ allowed: false, remaining: (\d+) \}/g, '{ allowed: false, remaining: $1, resetAt: 0 }')
  if (isTestFile(file)) {
    s = s.replace(/(\.findOne\([\s\S]*?\))\s*\.lean\(\)(?!\s*as)/g, '$1.lean() as import(\'@/lib/test/type-helpers\').LeanDoc | null')
    s = s.replace(/(\.findById\([\s\S]*?\))\s*\.lean\(\)(?!\s*as)/g, '$1.lean() as import(\'@/lib/test/type-helpers\').LeanDoc | null')
  }
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
console.log('files patched:', n)
