import { Suspense } from 'react'
import { requireServerOrgContext } from '@/lib/auth-server'
import { hasMinRole } from '@/lib/auth-helpers'
import { loadDelinquencySummary, filterByAgingBucket } from '@/lib/route-logic/collections'
import { serializeForRsc } from '@/lib/serialize-rsc'
import CollectionsView from './CollectionsView'
import CollectionsLoading from './loading'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

async function CollectionsServer({ aging }: { aging?: string }) {
  const ctx = await requireServerOrgContext()
  if (!hasMinRole(ctx.role, 'admin')) {
    redirect('/')
  }

  try {
    const summary = await loadDelinquencySummary(ctx.organizationId)
    const agingFilter =
      aging === '30' || aging === '60' || aging === '90' ? aging : ('all' as const)
    const items =
      agingFilter === 'all'
        ? summary.items
        : filterByAgingBucket(summary.items, Number(agingFilter) as 30 | 60 | 90)
    return (
      <CollectionsView
        initialData={serializeForRsc({ ...summary, items })}
        initialAging={agingFilter === 'all' ? 'all' : agingFilter}
      />
    )
  } catch (err) {
    console.error('[collections] server prefetch failed:', err)
    return <CollectionsView />
  }
}

export default async function CollectionsPage({
  searchParams,
}: {
  searchParams?: Promise<{ aging?: string }>
}) {
  const params = (await searchParams) ?? {}
  return (
    <Suspense fallback={<CollectionsLoading />}>
      <CollectionsServer aging={params.aging} />
    </Suspense>
  )
}
