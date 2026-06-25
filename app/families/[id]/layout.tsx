import { requireServerOrgContext } from '@/lib/auth-server'
import connectDB from '@/lib/database'
import { fetchFamilySummary } from '@/lib/family-detail-summary'
import { serializeForRsc } from '@/lib/serialize-rsc'
import FamilyDetailLayoutClient from './FamilyDetailLayoutClient'

export const dynamic = 'force-dynamic'

export default async function FamilyDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  let initialSummary = null
  try {
    const ctx = await requireServerOrgContext()
    await connectDB()
    const summary = await fetchFamilySummary(ctx.organizationId, id, ctx.role, ctx.userId)
    if (summary) {
      initialSummary = serializeForRsc(summary)
    }
  } catch (err) {
    console.error('[family-detail] server prefetch failed:', err)
  }

  return (
    <FamilyDetailLayoutClient initialSummary={initialSummary}>{children}</FamilyDetailLayoutClient>
  )
}
