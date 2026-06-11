import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve('c:/Users/jgoldberger/Desktop/KASA')

function patch(rel, fn) {
  const p = path.join(root, rel)
  let s = fs.readFileSync(p, 'utf8')
  const n = fn(s)
  if (n !== s) fs.writeFileSync(p, n)
}

const mailCast = (s) =>
  s
    .replace(/mock\.calls\[0\]!\[0\] as \{/g, 'mock.calls[0]?.[0] as unknown as {')
    .replace(/mock\.calls\.at\(-1\)!\[0\] as \{/g, 'mock.calls.at(-1)?.[0] as unknown as {')

patch('lib/statements/send-statement.integration.test.ts', mailCast)
patch('lib/tax-receipts/send-receipt.integration.test.ts', mailCast)

patch('lib/rate-limit.unit.test.ts', (s) => s.replace(/\{ failClosed: true, resetAt: 0 \}/g, '{ failClosed: true }'))

patch('lib/rate-limit.test.ts', (s) => s.replace(/Model\) as \{/g, 'Model) as unknown as {'))

patch('lib/route-logic/coverage-domain-families.integration.test.ts', (s) => {
  return s.replace(
    /const orgCtx = \{\s*organizationId: ([^,]+),\s*userId: ([^,]+),\s*role: 'owner' as const,\s*\}/g,
    'const orgCtx = mockOrgContext({ organizationId: $1, userId: $2, role: \'owner\' })',
  )
})

patch('lib/api/handler.test.ts', (s) => {
  return s.replace(
    /const org = \{\s*session: \{ user: \{ id: ([^,]+), email: ([^}]+) \} \},\s*userId: ([^,]+),\s*organizationId: ([^,]+),\s*role: 'admin',\s*\}/g,
    'const org = mockOrgContext({ organizationId: $4, userId: $3, role: \'admin\', email: $2 })',
  )
})

patch('lib/tax-receipts/queries.test.ts', (s) =>
  s.replace('expect(filter.familyId).toBeDefined()', 'expect((filter as { familyId?: unknown }).familyId).toBeDefined()'),
)

patch('lib/pagination.test.ts', (s) =>
  s.replace('(last as ScoreRow).score', '(last as ScoreRow | undefined)!.score').replace(
    "String(last._id)",
    'String((last as ScoreRow)._id)',
  ),
)

patch('app/api/route-logic-finish.integration.test.ts', (s) => {
  s = s.replace(/transporter as \{ sendMail/g, 'transporter as unknown as { sendMail')
  s = s.replace(/\{ ok: false, error: /g, '{ ok: false, email: null, error: ')
  return s
})

// smoke tests
patch('app/components/ui/Tooltip.smoke.test.tsx', (s) =>
  s.replace(
    /React\.createElement\(Component, \{ content: 'Tip' \}, 'Hover'\) as React\.ReactElement/,
    "React.createElement(Component, { content: 'Tip' }, 'Hover') as unknown as React.ReactElement",
  ),
)
patch('app/components/ui/Skeleton.smoke.test.tsx', (s) =>
  s.replace(/as React\.ReactElement/, 'as unknown as React.ReactElement'),
)

console.log('done')
