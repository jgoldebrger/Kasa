import { Suspense } from 'react'
import { requireServerOrgContext } from '@/lib/auth-server'
import connectDB from '@/lib/database'
import {
  CycleConfig,
  EmailConfig,
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

  // Four parallel reads, identical to what the client's mount useEffect
  // used to fan out as five sequential /api calls. Doing them on the
  // server eliminates the cold-compile penalty per route in dev mode
  // and one round-trip per call in prod.
  const [emailDoc, eventTypeDocs, planDocs, cycleDoc, orgDoc] = await Promise.all([
    EmailConfig.findOne({ isActive: true, organizationId }).lean<any>(),
    LifecycleEvent.find({ organizationId })
      .sort({ name: 1 })
      .lean<any[]>(),
    PaymentPlan.find({ organizationId })
      .sort({ planNumber: 1 })
      .lean<any[]>(),
    CycleConfig.findOne({ isActive: true, organizationId }).lean<any>(),
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

  // ---- payment plans (family rosters load lazily in PaymentPlansPanel) ----
  const initialPaymentPlans = planDocs.map((p: any) => ({
    _id: String(p._id),
    name: p.name,
    yearlyPrice: p.yearlyPrice,
    planNumber: p.planNumber,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    familyCount: 0,
    families: [],
  }))

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
