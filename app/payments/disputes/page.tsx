import { Suspense } from 'react'
import { requireServerOrgContext } from '@/lib/auth-server'
import DisputesView from './DisputesView'
import PaymentsLoading from '../loading'

export const dynamic = 'force-dynamic'

async function DisputesServer() {
  await requireServerOrgContext({ minRole: 'admin' })
  return <DisputesView />
}

export default function DisputesPage() {
  return (
    <Suspense fallback={<PaymentsLoading />}>
      <DisputesServer />
    </Suspense>
  )
}
