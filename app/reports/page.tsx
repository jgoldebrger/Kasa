import { Suspense } from 'react'
import { requireServerOrgContext } from '@/lib/auth-server'
import ReportsView from './ReportsView'
import ReportsLoading from './loading'

export const dynamic = 'force-dynamic'

async function ReportsServer() {
  await requireServerOrgContext({ minRole: 'admin' })
  const year = new Date().getFullYear()
  return <ReportsView initialReportData={null} initialYear={year} />
}

export default function ReportsPage() {
  return (
    <Suspense fallback={<ReportsLoading />}>
      <ReportsServer />
    </Suspense>
  )
}
