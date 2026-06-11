import { hasMinRole } from '@/lib/auth-helpers'
import { handler } from '@/lib/api/handler'
import { Family, FamilyMember, YearlyCalculation, Organization } from '@/lib/models'
import { calculateYearlyBalance } from '@/lib/calculations'
import { getYearInTimeZone } from '@/lib/date-utils'

/**
 * Lightweight dashboard summary. Replaces the previous pattern of fetching
 * the *entire* families list on the client just to count families and sum
 * memberCounts — that was O(N) DB rows and O(N) JSON over the wire for
 * what is really 4 numbers.
 *
 * This endpoint:
 *   - Counts families and members with $count (no document hydration).
 *   - Returns the current year's calculated totals, computing on the fly
 *     if no YearlyCalculation document exists yet.
 *   - Sets a short private cache so client-side navigations re-show the
 *     dashboard instantly.
 */
// Rate limit exempt: org-scoped read — see lib/rate-limit.ts (ORG_SCOPED_READ_EXEMPT_SCOPES).
export const GET = handler({
  auth: 'org',
  name: 'GET /api/dashboard-stats',
  fn: async ({ ctx, request }) => {
    const org = await Organization.findById(ctx!.organizationId).select('timezone').lean<{ timezone?: string }>()

    const { searchParams } = new URL(request.url)
    const yearParam = searchParams.get('year')
    let year = getYearInTimeZone(org?.timezone)
    if (yearParam) {
      const parsed = parseInt(yearParam, 10)
      if (!Number.isFinite(parsed) || parsed < 1900 || parsed > 2200) {
        return { status: 400, data: { error: 'Invalid year' } }
      }
      year = parsed
    }

    // Run independent reads in parallel.
    const [totalFamilies, totalMembers, calcDoc] = await Promise.all([
      Family.countDocuments({ organizationId: ctx!.organizationId }),
      FamilyMember.countDocuments({
        organizationId: ctx!.organizationId,
        convertedToFamily: { $ne: true },
      }),
      YearlyCalculation.findOne({ year, organizationId: ctx!.organizationId }).lean<any>(),
    ])

    const isAdmin = hasMinRole(ctx!.role, 'admin')

    let calculatedIncome = 0
    let calculatedExpenses = 0
    let balance = 0
    if (isAdmin) {
      if (calcDoc) {
        calculatedIncome = calcDoc.calculatedIncome ?? 0
        calculatedExpenses = calcDoc.calculatedExpenses ?? 0
        balance = calcDoc.balance ?? calculatedIncome - calculatedExpenses
      } else {
        try {
          const computed = await calculateYearlyBalance(year, ctx!.organizationId)
          calculatedIncome = computed.calculatedIncome ?? 0
          calculatedExpenses = computed.calculatedExpenses ?? 0
          balance = computed.balance ?? calculatedIncome - calculatedExpenses
        } catch (err) {
          console.error('[dashboard-stats] calc failed:', err)
        }
      }
    }

    return {
      data: {
        totalFamilies,
        totalMembers,
        ...(isAdmin
          ? { calculatedIncome, calculatedExpenses, balance, year }
          : {}),
      },
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=300' },
    }
  },
})
