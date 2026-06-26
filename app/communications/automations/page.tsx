import { Suspense } from 'react'
import { requireServerOrgContext } from '@/lib/auth-server'
import AutomationsView from '../_components/AutomationsView'
import CommunicationsLoading from '../loading'

export const dynamic = 'force-dynamic'

async function AutomationsServer() {
  await requireServerOrgContext({ minRole: 'admin' })
  return <AutomationsView />
}

export default function AutomationsPage() {
  return (
    <Suspense fallback={<CommunicationsLoading />}>
      <AutomationsServer />
    </Suspense>
  )
}
