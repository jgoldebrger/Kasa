import fs from 'node:fs'
import path from 'node:path'
const root = 'c:/Users/jgoldberger/Desktop/KASA'

function w(rel, fn) {
  const p = path.join(root, rel)
  const n = fn(fs.readFileSync(p, 'utf8'))
  fs.writeFileSync(p, n)
}

w('app/api/route-logic-finish.integration.test.ts', (s) => {
  s = s.replace(
    /nodemailer\.default\.createTransport\(\{\} as never\) as \{/g,
    'nodemailer.default.createTransport({} as never) as unknown as {',
  )
  s = s.replace(
    /mockResolvedValueOnce\(\{\s*ok: false,\s*error: /g,
    'mockResolvedValueOnce({ ok: false, email: null, error: ',
  )
  return s
})

w('lib/api/handler.test.ts', (s) => {
  if (!s.includes('mockOrgContext')) {
    s = s.replace(/^import /m, "import { mockOrgContext } from '@/lib/test/type-helpers'\nimport ")
  }
  return s.replace(
    /const ctx = \{\s*session: \{ user: \{ id: 'u1', email: 'a@b.com' \} \},\s*userId: 'u1',\s*organizationId: '507f1f77bcf86cd799439011',\s*role: 'admin' as const,\s*\}/g,
    "const ctx = mockOrgContext({ organizationId: '507f1f77bcf86cd799439011', userId: 'u1', role: 'admin', email: 'a@b.com' })",
  )
})

w('lib/rate-limit.test.ts', (s) =>
  s.replace(
    /mongoose\.models\.RateLimit as \{ findOneAndUpdate/g,
    'mongoose.models.RateLimit as unknown as { findOneAndUpdate',
  ),
)

w('lib/rate-limit.unit.test.ts', (s) =>
  s.replace(
    "isFailClosedScope('custom', { failClosed: true })",
    "isFailClosedScope('custom', { failClosed: true, limit: 1, windowMs: 60_000 })",
  ),
)

w('lib/client/export.dom.test.ts', (s) =>
  s.replace(
    "reactNodeToText(['a', { props: { children: 'b' } }])",
    "reactNodeToText(['a', { props: { children: 'b' } }] as import('react').ReactNode)",
  ),
)

w('lib/pagination.test.ts', (s) =>
  s.replace(
    "(last) => ({ v: (last as ScoreRow | undefined)!.score, id: String(last._id) })",
    "(last) => ({ v: (last as ScoreRow).score, id: String((last as ScoreRow)._id) })",
  ),
)

w('lib/jobs.integration.test.ts', (s) => {
  s = s.replace(
    /const families = await Family\.find\(\{ organizationId \}\)\.sort\(\{ _id: 1 \}\)\.lean\(\)/g,
    "const families = await Family.find({ organizationId }).sort({ _id: 1 }).lean() as import('@/lib/test/type-helpers').LeanDoc[]",
  )
  return s
})

const mailFix = (s) =>
  s.replace(
    /const mail = sendMail\.mock\.calls(\[[^\]]+\]|\.at\(-1\))?\??\.\[0\] as unknown as \{/g,
    'const mail = (sendMail.mock.calls as unknown as unknown[][])[0]?.[0] as unknown as {',
  ).replace(
    /const mail = sendMail\.mock\.calls\.at\(-1\)\?\.\[0\] as unknown as \{/g,
    'const mail = (sendMail.mock.calls as unknown as unknown[][]).at(-1)?.[0] as unknown as {',
  )

w('lib/statements/send-statement.integration.test.ts', (s) => {
  s = s.replace(/sendMail\.mock\.calls\[0\]\?\.\[0\] as unknown as \{/g, '(sendMail.mock.calls as unknown as unknown[][])[0]?.[0] as unknown as {')
  s = s.replace(/sendMail\.mock\.calls\.at\(-1\)\?\.\[0\] as unknown as \{/g, '(sendMail.mock.calls as unknown as unknown[][]).at(-1)?.[0] as unknown as {')
  return s
})
w('lib/tax-receipts/send-receipt.integration.test.ts', (s) => {
  s = s.replace(/sendMail\.mock\.calls\[0\]\?\.\[0\] as unknown as \{/g, '(sendMail.mock.calls as unknown as unknown[][])[0]?.[0] as unknown as {')
  s = s.replace(/sendMail\.mock\.calls\.at\(-1\)\?\.\[0\] as unknown as \{/g, '(sendMail.mock.calls as unknown as unknown[][]).at(-1)?.[0] as unknown as {')
  return s
})

w('app/components/ui/Tooltip.smoke.test.tsx', (s) =>
  s.replace(
    /render\(React\.createElement\(Component, \{ content: 'Tip' \}, 'Hover'\) as unknown as React\.ReactElement\)/,
    "render(React.createElement(Component, { content: 'Tip', children: 'Hover' }) as unknown as React.ReactElement)",
  ),
)

w('lib/route-logic/jobs/generate-monthly-statements-chunked.integration.test.ts', (s) => {
  if (s.includes('as unknown')) return s
  return s.replace(/(\w+)\[(\d+)\]\._id/g, '($1 as import(\'@/lib/test/type-helpers\').LeanDoc[])[$2]._id')
})

console.log('ok')
