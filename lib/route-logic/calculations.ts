import { handler } from '@/lib/api/handler'
import { YearlyCalculation } from '@/lib/models'
import { calculateAndSaveYear } from '@/lib/calculations'
import { calculation as calculationSchemas } from '@/lib/schemas'
import { checkRateLimit } from '@/lib/rate-limit'
import { collectCompoundCursorPages } from '@/lib/pagination'

// GET - Get yearly calculations
export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/calculations',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'calculations-get',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const searchParams = request.nextUrl.searchParams
    const yearRaw = searchParams.get('year')

    if (yearRaw) {
      const parsed = calculationSchemas.calculationQuery.safeParse({ year: yearRaw })
      if (!parsed.success || parsed.data.year === undefined) {
        return { status: 400, data: { error: 'Invalid year' } }
      }
      const yearNum = parsed.data.year
      let calculation = await YearlyCalculation.findOne({
        year: yearNum,
        organizationId: ctx!.organizationId,
      })
      if (!calculation) {
        // Auto-compute and save on first read so the UI always has data.
        calculation = await calculateAndSaveYear(yearNum, ctx!.organizationId, 0, 0)
      }
      return { data: calculation }
    }

    // Get all calculations
    const calculations = await collectCompoundCursorPages(
      (filter, limit) =>
        YearlyCalculation.find(filter).sort({ year: -1, _id: -1 }).limit(limit),
      { organizationId: ctx!.organizationId },
      'year',
      -1,
      (last) => ({
        v: Number(last.year),
        id: String(last._id),
      }),
    )
    return { data: calculations }
  },
})

// POST - Calculate and save for a specific year.
//
// admin+: this writes the YearlyCalculation snapshot the dashboard and
// the projections page both render. Admins can also pass
// `extraDonation` / `extraExpense` here, which directly mutate
// reported income / expense totals — a member-level role shouldn't be
// able to nudge the org's headline numbers.
export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  body: calculationSchemas.calculationPostBody,
  name: 'POST /api/calculations',
  fn: async ({ ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'calculations-run',
      { limit: 10, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const { year: yearNum, extraDonation: parsedDonation, extraExpense: parsedExpense } = body

    const calculation = await calculateAndSaveYear(
      yearNum,
      ctx!.organizationId,
      parsedDonation,
      parsedExpense,
    )

    return { status: 201, data: calculation }
  },
})
