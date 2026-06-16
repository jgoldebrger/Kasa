import { Suspense } from 'react'
import { requireServerOrgContext } from '@/lib/auth-server'
import { REPORT_SOURCES } from '@/lib/report-builder'
import ReportBuilderView from './ReportBuilderView'
import { SkeletonRows } from '@/app/components/ui'

export const dynamic = 'force-dynamic'

async function ReportBuilderServer() {
  await requireServerOrgContext({ minRole: 'admin' })
  return <ReportBuilderView initialSources={REPORT_SOURCES as any} />
}

function BuilderFallback() {
  return (
    <div className="min-h-screen p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto surface-card p-6">
        <SkeletonRows count={8} />
      </div>
    </div>
  )
}

export default function ReportBuilderPage() {
  return (
    <Suspense fallback={<BuilderFallback />}>
      <ReportBuilderServer />
    </Suspense>
  )
}
