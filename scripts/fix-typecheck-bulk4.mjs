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
  s = s.replace(/vi\.mocked\(auth\)\.mockResolvedValue\(null\)/g, 'vi.mocked(auth).mockResolvedValue(null as never)')
  s = s.replace(/\.mock\.calls\[0\]\[0\] as \{/g, '.mock.calls[0]?.[0] as unknown as {')
  s = s.replace(/\.mock\.calls\[0\]\[0\] as \{/g, '.mock.calls[0]?.[0] as unknown as {')
  if (s !== o) fs.writeFileSync(f, s)
}

// prepareDeepInvocation async
const probes = path.join(root, 'lib/test/api-route-deep-probes.ts')
let ps = fs.readFileSync(probes, 'utf8')
ps = ps.replace(
  'export function prepareDeepInvocation(',
  'export async function prepareDeepInvocation(',
)
ps = ps.replace(
  'request: buildMultipartImportRequest(url, headers, \'families-csv\'),',
  'request: await buildMultipartImportRequest(url, headers, \'families-csv\'),',
)
ps = ps.replace(
  '): { request: NextRequest; params: Record<string, string>; path: string } {',
  '): Promise<{ request: NextRequest; params: Record<string, string>; path: string }> {',
)
fs.writeFileSync(probes, ps)

console.log('patched')
