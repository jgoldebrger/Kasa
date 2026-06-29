import { Suspense } from 'react'
import { requireServerOrgContext } from '@/lib/auth-server'
import RecurringPaymentsView from '../_components/RecurringPaymentsView'
import PaymentsLoading from '../loading'

export const dynamic = 'force-dynamic'

async function RecurringPaymentsServer() {
  await requireServerOrgContext({ minRole: 'admin' })
  return <RecurringPaymentsView />
}

export default function RecurringPaymentsPage() {
  return (
    <Suspense fallback={<PaymentsLoading />}>
      <RecurringPaymentsServer />
    </Suspense>
  )
}
