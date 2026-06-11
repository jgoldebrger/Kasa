import { Suspense } from 'react'
import { requireServerOrgContext } from '@/lib/auth-server'
import connectDB from '@/lib/database'
import { Payment } from '@/lib/models'
import { PAYMENT_PUBLIC_SELECT } from '@/lib/payments/select'
import PaymentsView from './PaymentsView'
import PaymentsLoading from './loading'

// Page depends on the active-org cookie + session; never statically render.
export const dynamic = 'force-dynamic'

async function fetchInitialPayments(organizationId: string) {
  await connectDB()
  const rows = await Payment.find({ organizationId })
    .select(PAYMENT_PUBLIC_SELECT)
    .populate('familyId', 'name hebrewName email phone')
    .sort({ paymentDate: -1 })
    .limit(200)
    .lean<any[]>()

  // JSON round-trip flattens every ObjectId/Date into a string — required
  // for the RSC payload to serialize without falling back to a slow path.
  return rows.map((r) => JSON.parse(JSON.stringify(r)))
}

async function PaymentsServer() {
  const ctx = await requireServerOrgContext({ minRole: 'admin' })
  let initialPayments: any[] = []
  try {
    initialPayments = await fetchInitialPayments(ctx.organizationId)
  } catch (err) {
    // Server prefetch is best-effort — the client view will fall back to
    // fetching via /api/payments if this throws.
    console.error('[payments] server prefetch failed:', err)
  }
  return <PaymentsView initialPayments={initialPayments} />
}

export default function PaymentsPage() {
  return (
    <Suspense fallback={<PaymentsLoading />}>
      <PaymentsServer />
    </Suspense>
  )
}
