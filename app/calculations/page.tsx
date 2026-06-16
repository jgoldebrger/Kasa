import { Suspense } from 'react'
import { requireServerOrgContext } from '@/lib/auth-server'
import connectDB from '@/lib/database'
import { YearlyCalculation } from '@/lib/models'
import CalculationsView from './CalculationsView'
import CalculationsLoading from './loading'

// Page depends on the active-org cookie + session; never statically render.
export const dynamic = 'force-dynamic'

async function fetchInitialCalculations(organizationId: string) {
  await connectDB()
  const rows = await YearlyCalculation.find({ organizationId })
    .sort({ year: -1 })
    .lean<any[]>()

  // JSON round-trip flattens every ObjectId/Date into a plain string so
  // React's RSC payload serializer accepts the prop without falling back
  // to its slow path.
  return rows.map((r) => JSON.parse(JSON.stringify(r)))
}

async function CalculationsServer() {
  const ctx = await requireServerOrgContext({ minRole: 'admin' })
  try {
    const initialCalculations = await fetchInitialCalculations(ctx.organizationId)
    return <CalculationsView initialCalculations={initialCalculations} />
  } catch (err) {
    console.error('[calculations] server prefetch failed:', err)
    return <CalculationsView />
  }
}

export default function CalculationsPage() {
  return (
    <Suspense fallback={<CalculationsLoading />}>
      <CalculationsServer />
    </Suspense>
  )
}
