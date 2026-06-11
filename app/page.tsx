import { Suspense } from 'react'
import { requireServerOrgContext } from '@/lib/auth-server'
import { hasMinRole } from '@/lib/auth-helpers'
import connectDB from '@/lib/database'
import { Family, FamilyMember, Task, YearlyCalculation } from '@/lib/models'
import DashboardView from './DashboardView'
import Loading from './loading'

export const dynamic = 'force-dynamic'

async function fetchInitialDashboardData(organizationId: string, includeFinancials: boolean) {
  await connectDB()
  const year = new Date().getFullYear()

  // Only pull what the first paint actually shows:
  //  - Family + member counts (for the stat cards)
  //  - The cached yearly calc (if any) for the balance / income / expense
  //  - The first 10 tasks (the UI only renders 5, but we want some headroom
  //    so quick toggles don't trigger a refetch).
  // The full task array stays in the client's existing `/api/tasks` call
  // which still runs in useEffect to keep the page interactive.
  const [totalFamilies, totalMembers, calcDoc, taskDocs] = await Promise.all([
    Family.countDocuments({ organizationId }),
    FamilyMember.countDocuments({ organizationId, convertedToFamily: { $ne: true } }),
    includeFinancials
      ? YearlyCalculation.findOne({ year, organizationId }).lean<any>()
      : Promise.resolve(null),
    includeFinancials
      ? Task.find({ organizationId })
          .select('_id title description dueDate priority status relatedFamilyId relatedMemberId')
          .populate('relatedFamilyId', 'name')
          .sort({ dueDate: 1, priority: -1 })
          .limit(10)
          .lean<any[]>()
      : Promise.resolve([] as any[]),
  ])

  let calculatedIncome = 0
  let calculatedExpenses = 0
  let balance = 0
  if (includeFinancials && calcDoc) {
    calculatedIncome = calcDoc.calculatedIncome ?? 0
    calculatedExpenses = calcDoc.calculatedExpenses ?? 0
    balance = calcDoc.balance ?? calculatedIncome - calculatedExpenses
  }
  // Note: we intentionally do NOT fall back to calculateYearlyBalance() here.
  // That helper kicks off ~6 sequential Mongo reads and would block first
  // paint for new/empty orgs. The client's /api/dashboard-stats useEffect
  // does it instead — the user sees zeroes briefly and then real data
  // populates, but the page is interactive immediately.

  const initialStats = {
    totalFamilies,
    totalMembers,
    totalIncome: calculatedIncome,
    totalExpenses: calculatedExpenses,
    balance,
  }

  // JSON round-trip serializes every ObjectId / Date / Mongoose internal
  // into plain JSON before it crosses the server→client component boundary.
  const initialTasks = taskDocs.map((t) => JSON.parse(JSON.stringify(t)))

  return { initialStats, initialTasks }
}

async function DashboardServer() {
  const ctx = await requireServerOrgContext()
  const showFinancials = hasMinRole(ctx.role, 'admin')
  try {
    const data = await fetchInitialDashboardData(ctx.organizationId, showFinancials)
    return (
      <DashboardView
        initialStats={data.initialStats}
        initialTasks={data.initialTasks}
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
