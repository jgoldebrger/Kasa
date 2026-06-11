import { Suspense } from 'react'
import { requireServerOrgContext } from '@/lib/auth-server'
import connectDB from '@/lib/database'
import {
  CycleConfig,
  EmailConfig,
  Family,
  LifecycleEvent,
  Organization,
  PaymentPlan,
} from '@/lib/models'
import SettingsView from './SettingsView'
import SettingsLoading from './loading'

export const dynamic = 'force-dynamic'

const CYCLE_DEFAULTS = {
  cycleCalendar: 'gregorian' as const,
  cycleStartMonth: 9,
  cycleStartDay: 1,
  cycleStartHebrewMonth: 7, // Tishrei
  cycleStartHebrewDay: 1,
  cycleAutoRollover: false,
  description: 'Membership cycle start date',
  isActive: true,
}

async function fetchInitialSettings(organizationId: string) {
  await connectDB()

  // Five parallel reads, identical to what the client's mount useEffect
  // used to fan out as five sequential /api calls. Doing them on the
  // server eliminates the cold-compile penalty per route in dev mode
  // and one round-trip per call in prod.
  const [emailDoc, eventTypeDocs, planDocs, cycleDoc, familyDocs, orgDoc] =
    await Promise.all([
      EmailConfig.findOne({ isActive: true, organizationId }).lean<any>(),
      LifecycleEvent.find({ organizationId })
        .sort({ name: 1 })
        .lean<any[]>(),
      // Payment plans + their family rosters, matching /api/payment-plans.
      // We do plans first, then a single $in join to pull family rosters
      // (avoids the N+1 the legacy route had to defensively fix).
      PaymentPlan.find({ organizationId })
        .sort({ planNumber: 1 })
        .lean<any[]>(),
      CycleConfig.findOne({ isActive: true, organizationId }).lean<any>(),
      Family.find({ organizationId })
        .select('_id name weddingDate paymentPlanId')
        .sort({ name: 1 })
        .lean<any[]>(),
      Organization.findById(organizationId)
        .select('planTier subscriptionStatus trialEndsAt currentPeriodEnd stripeCustomerId')
        .lean<any>(),
    ])

  // ---- email-config: normalize "no doc" into { configured: false } ----
  const initialEmailConfig = emailDoc
    ? {
        configured: true,
        email: emailDoc.email,
        fromName: emailDoc.fromName,
        isActive: emailDoc.isActive,
      }
    : { configured: false }

  // ---- event types ----
  const initialEventTypes = eventTypeDocs.map((e) => JSON.parse(JSON.stringify(e)))

  // ---- payment plans with family rosters (matches /api/payment-plans) ----
  const byPlan = new Map<string, any[]>()
  for (const f of familyDocs) {
    if (!f.paymentPlanId) continue
    const key = String(f.paymentPlanId)
    if (!byPlan.has(key)) byPlan.set(key, [])
    byPlan.get(key)!.push({
      _id: String(f._id),
      name: f.name,
      weddingDate: f.weddingDate,
    })
  }
  const initialPaymentPlans = planDocs.map((p: any) => {
    const families = byPlan.get(String(p._id)) || []
    return {
      _id: String(p._id),
      name: p.name,
      yearlyPrice: p.yearlyPrice,
      planNumber: p.planNumber,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      familyCount: families.length,
      families,
    }
  })

  // ---- cycle config: matches the API's defaults-on-missing behavior ----
  const initialCycleConfig = cycleDoc
    ? {
        cycleCalendar: cycleDoc.cycleCalendar === 'hebrew' ? 'hebrew' : 'gregorian',
        cycleStartMonth: cycleDoc.cycleStartMonth,
        cycleStartDay: cycleDoc.cycleStartDay,
        cycleStartHebrewMonth:
          typeof cycleDoc.cycleStartHebrewMonth === 'number' ? cycleDoc.cycleStartHebrewMonth : 7,
        cycleStartHebrewDay:
          typeof cycleDoc.cycleStartHebrewDay === 'number' ? cycleDoc.cycleStartHebrewDay : 1,
        cycleAutoRollover: Boolean(cycleDoc.cycleAutoRollover),
        description: cycleDoc.description,
        isActive: cycleDoc.isActive,
      }
    : CYCLE_DEFAULTS

  const initialBilling = orgDoc
    ? {
        planTier: orgDoc.planTier ?? null,
        subscriptionStatus: orgDoc.subscriptionStatus ?? null,
        trialEndsAt: orgDoc.trialEndsAt?.toISOString?.() ?? orgDoc.trialEndsAt ?? null,
        currentPeriodEnd:
          orgDoc.currentPeriodEnd?.toISOString?.() ?? orgDoc.currentPeriodEnd ?? null,
        stripeCustomerId: orgDoc.stripeCustomerId ?? null,
      }
    : null

  return {
    initialEmailConfig,
    initialEventTypes,
    initialPaymentPlans,
    initialCycleConfig,
    initialBilling,
  }
}

async function SettingsServer() {
  const ctx = await requireServerOrgContext({ minRole: 'admin' })
  // Role is already on the JWT-resolved context — no /api/org-members
  // round-trip needed for the tab gating.
  const initialCurrentRole = (ctx.role ?? null) as
    | 'owner'
    | 'admin'
    | 'member'
    | null

  let data: Awaited<ReturnType<typeof fetchInitialSettings>> | null = null
  try {
    data = await fetchInitialSettings(ctx.organizationId)
  } catch (err) {
    console.error('[settings] server prefetch failed:', err)
  }

  return (
    <SettingsView
      initialEmailConfig={data?.initialEmailConfig}
      initialEventTypes={data?.initialEventTypes}
      initialPaymentPlans={data?.initialPaymentPlans}
      initialCycleConfig={data?.initialCycleConfig}
      initialCurrentRole={initialCurrentRole}
      initialBilling={data?.initialBilling}
    />
  )
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsLoading />}>
      <SettingsServer />
    </Suspense>
  )
}
