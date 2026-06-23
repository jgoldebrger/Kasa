import { Suspense } from 'react'
import connectDB from '@/lib/database'
import { Organization } from '@/lib/models'
import { requireServerOrgContext } from '@/lib/auth-server'
import SettingsView from './SettingsView'
import SettingsLoading from './loading'

export const dynamic = 'force-dynamic'

async function SettingsServer() {
  const ctx = await requireServerOrgContext({ minRole: 'admin', skipSubscriptionGate: true })
  const initialCurrentRole = (ctx.role ?? null) as 'owner' | 'admin' | 'member' | null

  await connectDB()
  const org = await Organization.findById(ctx.organizationId)
    .select('planTier subscriptionStatus trialEndsAt currentPeriodEnd stripeCustomerId')
    .lean<{
      planTier?: string | null
      subscriptionStatus?: string | null
      trialEndsAt?: Date | null
      currentPeriodEnd?: Date | null
      stripeCustomerId?: string | null
    }>()

  const initialBilling = org
    ? {
        planTier: org.planTier ?? null,
        subscriptionStatus: org.subscriptionStatus ?? null,
        trialEndsAt: org.trialEndsAt?.toISOString() ?? null,
        currentPeriodEnd: org.currentPeriodEnd?.toISOString() ?? null,
        stripeCustomerId: org.stripeCustomerId ?? null,
      }
    : null

  return <SettingsView initialCurrentRole={initialCurrentRole} initialBilling={initialBilling} />
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsLoading />}>
      <SettingsServer />
    </Suspense>
  )
}
