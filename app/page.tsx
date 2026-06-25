import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { requireServerOrgContext } from '@/lib/auth-server'
import { hasMinRole } from '@/lib/auth-helpers'
import connectDB from '@/lib/database'
import { Organization, Family, FamilyMember, YearlyCalculation } from '@/lib/models'
import { calculateYearlyExpenses } from '@/lib/calculations'
import { loadSetupProgress } from '@/lib/organizations/setup-progress-data'
import { loadDashboardAttention } from '@/lib/route-logic/dashboard-actions'
import { serializeForRsc } from '@/lib/serialize-rsc'
import DashboardView from './DashboardView'
import Loading from './loading'

export const dynamic = 'force-dynamic'

async function fetchInitialDashboardData(organizationId: string, includeFinancials: boolean) {
  await connectDB()
  const year = new Date().getFullYear()

  // Only pull what the first paint actually shows: family + member counts and
  // the cached yearly calc (if any) for balance / income / expense totals.
  const [totalFamilies, totalMembers, calcDoc] = await Promise.all([
    Family.countDocuments({ organizationId }),
    FamilyMember.countDocuments({ organizationId, convertedToFamily: { $ne: true } }),
    includeFinancials
      ? YearlyCalculation.findOne({ year, organizationId }).lean<any>()
      : Promise.resolve(null),
  ])

  let calculatedIncome = 0
  let calculatedExpenses = 0
  let balance = 0
  if (includeFinancials && calcDoc) {
    calculatedIncome = calcDoc.calculatedIncome ?? 0
    const expenseData = await calculateYearlyExpenses(
      year,
      organizationId,
      calcDoc.extraExpense ?? 0,
    )
    calculatedExpenses = expenseData.calculatedExpenses
    balance = calculatedIncome - calculatedExpenses
  }
  // Note: we intentionally do NOT fall back to calculateYearlyBalance() here.
  // That helper kicks off ~6 sequential Mongo reads and would block first
  // paint for new/empty orgs. The client fetches /api/dashboard-stats instead;
  // DashboardView shows skeletons until that live calc completes.

  const initialStats = {
    totalFamilies,
    totalMembers,
    totalIncome: calculatedIncome,
    totalExpenses: calculatedExpenses,
    balance,
  }

  const financialsComplete = !includeFinancials || calcDoc != null

  let initialSetupProgress = null
  let initialAttention = null
  if (includeFinancials) {
    const [setupProgress, attention] = await Promise.all([
      loadSetupProgress(organizationId).catch((err) => {
        console.error('[dashboard] setup-progress prefetch failed:', err)
        return null
      }),
      loadDashboardAttention(organizationId).catch((err) => {
        console.error('[dashboard] attention prefetch failed:', err)
        return null
      }),
    ])
    initialSetupProgress = setupProgress
    initialAttention = attention ? serializeForRsc(attention) : null
  }

  return { initialStats, financialsComplete, initialSetupProgress, initialAttention }
}

async function DashboardServer() {
  const ctx = await requireServerOrgContext()

  if (hasMinRole(ctx.role, 'owner')) {
    await connectDB()
    const org = await Organization.findById(ctx.organizationId)
      .select('setupCompletedAt')
      .lean<{ setupCompletedAt?: Date | null }>()
    if (!org?.setupCompletedAt) {
      redirect('/setup')
    }
  }

  const showFinancials = hasMinRole(ctx.role, 'admin')
  try {
    const data = await fetchInitialDashboardData(ctx.organizationId, showFinancials)
    return (
      <DashboardView
        initialStats={data.initialStats}
        initialFinancialsComplete={data.financialsComplete}
        initialSetupProgress={data.initialSetupProgress}
        initialAttention={data.initialAttention}
        showFinancials={showFinancials}
      />
    )
  } catch (err) {
    console.error('[dashboard] server prefetch failed:', err)
    return <DashboardView showFinancials={showFinancials} />
  }
}

export default function HomePage() {
  return (
    <Suspense fallback={<Loading />}>
      <DashboardServer />
    </Suspense>
  )
}
