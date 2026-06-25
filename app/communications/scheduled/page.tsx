import { Suspense } from 'react'
import { requireServerOrgContext } from '@/lib/auth-server'
import ScheduledView from '../_components/ScheduledView'
import CommunicationsLoading from '../loading'

export const dynamic = 'force-dynamic'

async function ScheduledServer() {
  await requireServerOrgContext({ minRole: 'admin' })
  return <ScheduledView />
}

export default function ScheduledPage() {
  return (
    <Suspense fallback={<CommunicationsLoading />}>
      <ScheduledServer />
    </Suspense>
  )
}
