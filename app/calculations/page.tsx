import { Suspense } from 'react'
import { requireServerOrgContext } from '@/lib/auth-server'
import connectDB from '@/lib/database'
import { YearlyCalculation } from '@/lib/models'
import { serializeForRsc } from '@/lib/serialize-rsc'
import CalculationsView from './CalculationsView'
import CalculationsLoading from './loading'

// Page depends on the active-org cookie + session; never statically render.
export const dynamic = 'force-dynamic'

async function fetchInitialCalculations(organizationId: string) {
  await connectDB()
  const rows = await YearlyCalculation.find({ organizationId })
    .sort({ year: -1 })
    .limit(30)
    .lean<any[]>()

  return rows.map((r) => serializeForRsc(r))
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
