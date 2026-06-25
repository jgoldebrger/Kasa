import { Suspense } from 'react'
import { requireServerOrgContext } from '@/lib/auth-server'
import CommunicationsView from './CommunicationsView'
import CommunicationsLoading from './loading'

export const dynamic = 'force-dynamic'

async function CommunicationsServer() {
  await requireServerOrgContext({ minRole: 'admin' })
  return <CommunicationsView />
}

export default function CommunicationsPage() {
  return (
    <Suspense fallback={<CommunicationsLoading />}>
      <CommunicationsServer />
    </Suspense>
  )
}
