import { Suspense } from 'react'
import { requireServerOrgContext } from '@/lib/auth-server'
import connectDB from '@/lib/database'
import { Family, Statement } from '@/lib/models'
import StatementsView from './StatementsView'
import StatementsLoading from './loading'

export const dynamic = 'force-dynamic'

async function fetchInitialData(organizationId: string) {
  await connectDB()

  // Match the client's filter: only last-month statements show on this page.
  const now = new Date()
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)

  const [statementDocs, familyDocs] = await Promise.all([
    Statement.find({ organizationId, fromDate: { $gte: lastMonth, $lte: lastMonthEnd } })
      .select('-organizationId -__v -updatedAt')
      .sort({ date: -1 })
      .lean<any[]>(),
    Family.find({ organizationId }).select('_id name').lean<any[]>(),
  ])

  // JSON round-trip → all ObjectId/Date instances become plain strings,
  // which is what the RSC payload serializer expects.
  const initialStatements = statementDocs.map((s) => JSON.parse(JSON.stringify(s)))
  const initialFamilies = familyDocs.map((f) => ({
    _id: String(f._id),
    name: f.name,
  }))

  return { initialStatements, initialFamilies }
}

async function StatementsServer() {
  const ctx = await requireServerOrgContext({ minRole: 'admin' })
  try {
    const data = await fetchInitialData(ctx.organizationId)
    return (
      <StatementsView
        initialStatements={data.initialStatements}
        initialFamilies={data.initialFamilies}
      />
    )
  } catch (err) {
    console.error('[statements] server prefetch failed:', err)
    return <StatementsView />
  }
}

export default function StatementsPage() {
  return (
    <Suspense fallback={<StatementsLoading />}>
      <StatementsServer />
    </Suspense>
  )
}
