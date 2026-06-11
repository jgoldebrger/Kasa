import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve('c:/Users/jgoldberger/Desktop/KASA')

function patch(rel, fn) {
  const p = path.join(root, rel)
  const s = fs.readFileSync(p, 'utf8')
  const n = fn(s)
  if (n !== s) fs.writeFileSync(p, n)
}

patch('lib/calculations.test.ts', (s) => s.replace(/\)\s+as\s+\{\s*\$or:/g, ') as unknown as { $or:'))

patch('lib/route-logic/coverage-domain-families.integration.test.ts', (s) => {
  if (!s.includes('mockOrgContext')) {
    s = s.replace(/^import /m, "import { mockOrgContext } from '@/lib/test/type-helpers'\nimport ")
  }
  return s.replace(
    /\{\s*organizationId: ([^,]+),\s*userId: ([^,]+),\s*role: 'owner'(?: as const)?\s*\}/g,
    'mockOrgContext({ organizationId: $1, userId: $2, role: \'owner\' })',
  )
})

patch('lib/api/handler.test.ts', (s) => {
  if (!s.includes('mockOrgContext')) {
    s = s.replace(/^import /m, "import { mockOrgContext } from '@/lib/test/type-helpers'\nimport ")
  }
  return s.replace(
    /\{\s*session: \{ user: \{ id: '([^']+)', email: '([^']+)' \} \},\s*userId: '([^']+)',\s*organizationId: '([^']+)',\s*role: 'admin',\s*\}/g,
    "mockOrgContext({ organizationId: '$4', userId: '$3', role: 'admin', email: '$2' })",
  )
})

patch('lib/rate-limit.test.ts', (s) =>
  s.replace(/\) as \{ findOneAndUpdate/g, ') as unknown as { findOneAndUpdate'),
)

patch('lib/log.test.ts', (s) => s.replace(/delete process\.env\.NODE_ENV/g, 'delete (process.env as Record<string, string | undefined>).NODE_ENV'))

// route-logic-finish line fixes via patterns
patch('app/api/route-logic-finish.integration.test.ts', (s) => {
  s = s.replace(/\{ ok: false, error: /g, '{ ok: false, email: null, error: ')
  s = s.replace(
    /\.mockResolvedValue\(undefined\)/g,
    ".mockResolvedValue({ success: true, month: 1, year: 2024, generated: 0, failed: 0, statements: [], errors: [], hasMore: false, familyCursorOut: null })",
  )
  s = s.replace(/\) as \{ sendMail/g, ') as unknown as { sendMail')
  return s
})

patch('lib/route-logic/jobs/coverage-jobs-branches.integration.test.ts', (s) =>
  s.replace(
    /\.mockResolvedValue\(undefined\)/g,
    ".mockResolvedValue({ success: true, month: 1, year: 2024, generated: 0, failed: 0, statements: [], errors: [], hasMore: false, familyCursorOut: null })",
  ),
)

patch('lib/route-logic/jobs/generate-monthly-statements-chunked.integration.test.ts', (s) => {
  s = s.replace(
    /mockResolvedValue\(\{ balance: (\d+) \}\)/g,
    'mockResolvedValue({ openingBalance: 0, planCost: 0, totalPayments: 0, totalWithdrawals: 0, totalLifecyclePayments: 0, totalCycleCharges: 0, balance: $1 })',
  )
  return s
})

patch('lib/rate-limit.unit.test.ts', (s) =>
  s.replace(/\{ failClosed: true \}/g, '{ failClosed: true, resetAt: 0 }'),
)

patch('lib/tax-receipts/queries.test.ts', (s) => {
  if (s.includes('familyId') && s.includes('expect(')) {
    return s.replace(/expect\(([^)]+)\)\.toMatchObject\(/g, 'expect($1 as Record<string, unknown>).toMatchObject(')
  }
  return s
})

console.log('targeted patches done')
