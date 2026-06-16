import { Suspense } from 'react'
import { requireServerOrgContext } from '@/lib/auth-server'
import connectDB from '@/lib/database'
import { Payment } from '@/lib/models'
import { PAYMENT_PUBLIC_SELECT } from '@/lib/payments/select'
import { PAYMENTS_LIST_PAGE_SIZE } from '@/lib/client/payments-list'
import { encodeCompoundCursor } from '@/lib/pagination'
import PaymentsView from './PaymentsView'
import PaymentsLoading from './loading'

export const dynamic = 'force-dynamic'

async function fetchInitialPayments(organizationId: string) {
  await connectDB()
  const rows = await Payment.find({ organizationId })
    .select(PAYMENT_PUBLIC_SELECT)
    .populate('familyId', 'name hebrewName email phone')
    .sort({ paymentDate: -1, _id: -1 })
    .limit(PAYMENTS_LIST_PAGE_SIZE + 1)
    .lean<any[]>()

  let nextCursor: string | null = null
  let items = rows
  if (rows.length > PAYMENTS_LIST_PAGE_SIZE) {
    items = rows.slice(0, PAYMENTS_LIST_PAGE_SIZE)
    const last = items[items.length - 1]
    if (last) {
      nextCursor = encodeCompoundCursor({
        v: last.paymentDate ? new Date(last.paymentDate).getTime() : null,
        id: String(last._id),
      })
    }
  }

  return {
    items: items.map((r) => JSON.parse(JSON.stringify(r))),
    nextCursor,
  }
}

async function PaymentsServer() {
  const ctx = await requireServerOrgContext({ minRole: 'admin' })
  try {
    const { items, nextCursor } = await fetchInitialPayments(ctx.organizationId)
    return <PaymentsView initialPayments={items} initialNextCursor={nextCursor} />
  } catch (err) {
    console.error('[payments] server prefetch failed:', err)
    return <PaymentsView />
  }
}

export default function PaymentsPage() {
  return (
    <Suspense fallback={<PaymentsLoading />}>
      <PaymentsServer />
    </Suspense>
  )
}
