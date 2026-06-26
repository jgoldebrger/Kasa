import { Suspense } from 'react'
import { requireServerOrgContext } from '@/lib/auth-server'
import AnalyticsView from '../_components/AnalyticsView'
import CommunicationsLoading from '../loading'

export const dynamic = 'force-dynamic'

async function AnalyticsServer() {
  await requireServerOrgContext({ minRole: 'admin' })
  return <AnalyticsView />
}

export default function AnalyticsPage() {
  return (
    <Suspense fallback={<CommunicationsLoading />}>
      <AnalyticsServer />
    </Suspense>
  )
}
