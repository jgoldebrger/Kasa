import { handler } from '@/lib/api/handler'
import { Organization } from '@/lib/models'
import { getYearInTimeZone } from '@/lib/date-utils'
import { DEFAULT_DUES_FORECAST_YEARS, loadDuesRecommendation } from '@/lib/projections'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

// GET — returns the break-even dues recommendation for the current org.
//
// Query params:
//   ?windowYears=N    — how many years of history to average (1..10, default 5)
//   ?forecastYears=N  — how many years of forward projection (1..50, default 20)
//   ?startYear=YYYY   — first year in the projection table (default: current year).
//                       Clamped to [currentYear - 5, currentYear + 50] to keep the
//                       table grounded in reality without hard-failing on slightly
//                       odd inputs.
export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/dues-recommendation',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'dues-recommendation',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const org = await Organization.findById(ctx!.organizationId).select('timezone').lean<{ timezone?: string }>()

    const url = new URL(request.url)
    const rawWindow = url.searchParams.get('windowYears')
    let windowYears = 5
    if (rawWindow !== null) {
      const n = Number(rawWindow)
      if (!Number.isFinite(n) || n < 1 || n > 10) {
        return {
          status: 400,
          data: { error: 'windowYears must be an integer between 1 and 10' },
        }
      }
      windowYears = Math.floor(n)
    }

    const rawForecast = url.searchParams.get('forecastYears')
    let forecastYears = DEFAULT_DUES_FORECAST_YEARS
    if (rawForecast !== null) {
      const n = Number(rawForecast)
      if (!Number.isFinite(n) || n < 1 || n > 50) {
        return {
          status: 400,
          data: { error: 'forecastYears must be an integer between 1 and 50' },
        }
      }
      forecastYears = Math.floor(n)
    }

    const rawStart = url.searchParams.get('startYear')
    const currentYear = getYearInTimeZone(org?.timezone)
    let startYear: number | undefined = undefined
    if (rawStart !== null) {
      const n = Number(rawStart)
      const min = currentYear - 5
      const max = currentYear + 50
      if (!Number.isFinite(n) || n < min || n > max) {
        return {
          status: 400,
          data: { error: `startYear must be an integer between ${min} and ${max}` },
        }
      }
      startYear = Math.floor(n)
    }

    const recommendation = await loadDuesRecommendation(
      ctx!.organizationId,
      windowYears,
      forecastYears,
      startYear,
    )
    return { data: recommendation }
  },
})
