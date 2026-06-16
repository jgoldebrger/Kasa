import { Suspense } from 'react'
import { requireServerOrgContext } from '@/lib/auth-server'
import { loadDuesRecommendation, type DuesRecommendation } from '@/lib/projections'
import { serializeForRsc } from '@/lib/serialize-rsc'
import ProjectionsView from './ProjectionsView'
import ProjectionsLoading from './loading'

// Depends on the active-org cookie + session; never statically render.
export const dynamic = 'force-dynamic'

const DEFAULT_WINDOW_YEARS = 5

async function ProjectionsServer() {
  const ctx = await requireServerOrgContext({ minRole: 'admin' })
  try {
    const recommendation = await loadDuesRecommendation(ctx.organizationId, DEFAULT_WINDOW_YEARS)
    // JSON round-trip strips any incidental ObjectId/Date in the payload.
    return (
      <ProjectionsView
        initialRecommendation={serializeForRsc(recommendation) as DuesRecommendation}
        initialWindowYears={DEFAULT_WINDOW_YEARS}
      />
    )
  } catch (err) {
    console.error('[projections] server prefetch failed:', err)
    // The client view falls back to /api/dues-recommendation.
    return <ProjectionsView initialRecommendation={null} initialWindowYears={DEFAULT_WINDOW_YEARS} />
  }
}

export default function ProjectionsPage() {
  return (
    <Suspense fallback={<ProjectionsLoading />}>
      <ProjectionsServer />
    </Suspense>
  )
}
