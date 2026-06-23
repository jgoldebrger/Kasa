import { redirect } from 'next/navigation'
import connectDB from '@/lib/database'
import { Organization } from '@/lib/models'
import { requireServerOrgContext } from '@/lib/auth-server'
import { hasMinRole } from '@/lib/auth-helpers'
import SetupWizard from './SetupWizard'

export const dynamic = 'force-dynamic'

export default async function SetupPage() {
  const ctx = await requireServerOrgContext({ skipSubscriptionGate: true })

  if (!hasMinRole(ctx.role, 'owner')) {
    redirect('/')
  }

  await connectDB()
  const org = await Organization.findById(ctx.organizationId).select('name setupCompletedAt').lean<{
    name?: string
    setupCompletedAt?: Date | null
  }>()

  if (org?.setupCompletedAt) {
    redirect('/')
  }

  return <SetupWizard initialOrgName={org?.name || ''} />
}
