import { Suspense } from 'react'
import { requireServerOrgContext } from '@/lib/auth-server'
import JobsView from '../_components/JobsView'
import CommunicationsLoading from '../loading'

export const dynamic = 'force-dynamic'

async function JobsServer() {
  await requireServerOrgContext({ minRole: 'admin' })
  return <JobsView />
}

export default function JobsPage() {
  return (
    <Suspense fallback={<CommunicationsLoading />}>
      <JobsServer />
    </Suspense>
  )
}
