import fs from 'node:fs'
import path from 'node:path'
const p = path.join('c:/Users/jgoldberger/Desktop/KASA/lib/api/handler.test.ts')
let s = fs.readFileSync(p, 'utf8')
if (!s.includes('mockOrgContext')) {
  s = s.replace(/^import /m, "import { mockOrgContext } from '@/lib/test/type-helpers'\nimport ")
}
s = s.replace(
  /const ctx = \{\s*session: \{ user: \{ id: 'u1', email: 'a@b.com' \} \},\s*userId: 'u1',\s*organizationId: '507f1f77bcf86cd799439011',\s*role: 'admin' as const,\s*\}/,
  "const ctx = mockOrgContext({ organizationId: '507f1f77bcf86cd799439011', userId: 'u1', role: 'admin', email: 'a@b.com' })",
)
fs.writeFileSync(p, s)

const sched = path.join('c:/Users/jgoldberger/Desktop/KASA/lib/scheduler.integration.test.ts')
let ss = fs.readFileSync(sched, 'utf8')
ss = ss.replace(
  /Statement\.find\(\{ organizationId: orgId \}\)\.lean\(\) as import\('@\/lib\/test\/type-helpers'\)\.LeanDoc \| null/g,
  "Statement.find({ organizationId: orgId }).lean() as import('@/lib/test/type-helpers').LeanDoc[]",
)
ss = ss.replace(/row!\.fromDate\.getTime\(\)/g, '(row!.fromDate as Date).getTime()')
ss = ss.replace(/row!\.toDate\.getTime\(\)/g, '(row!.toDate as Date).getTime()')
ss = ss.replace(/rows\[0\]\.familyId/g, '(rows[0] as import(\'@/lib/test/type-helpers\').LeanDoc).familyId')
fs.writeFileSync(sched, ss)
