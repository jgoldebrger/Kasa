import { handler } from '@/lib/api/handler'
import { Organization } from '@/lib/models'
import { generateMonthlyStatements } from '@/lib/scheduler'
import { checkRateLimit } from '@/lib/rate-limit'

// POST - Auto-generate monthly statements (can be called by cron job).
// Accepts an admin session OR a cron secret + ?organizationId=<id>.
export const POST = handler({
  auth: 'org-or-cron',
  minRole: 'admin',
  name: 'POST /api/statements/auto-generate',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'auto-generate-statements',
      { limit: 5, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const result = await generateMonthlyStatements(ctx!.organizationId)
    return { status: 201, data: result }
  },
})

// GET - Generate statements for a specific month
export const GET = handler({
  auth: 'org-or-cron',
  minRole: 'admin',
  name: 'GET /api/statements/auto-generate',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'auto-generate-statements',
      { limit: 10, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const { searchParams } = new URL(request.url)
    const yearRaw = searchParams.get('year')
    const monthRaw = searchParams.get('month')
    let year: number | undefined
    let month: number | undefined
    if (yearRaw) {
      year = parseInt(yearRaw, 10)
      if (!Number.isFinite(year) || year < 1900 || year > 2200) {
        return { status: 400, data: { error: 'Invalid year' } }
      }
    }
    if (monthRaw) {
      const org = await Organization.findById(ctx!.organizationId)
        .select('monthlyStatementCalendar')
        .lean<{ monthlyStatementCalendar?: 'gregorian' | 'hebrew' }>()
      const isHebrew = org?.monthlyStatementCalendar === 'hebrew'
      const maxMonth = isHebrew ? 13 : 12
      month = parseInt(monthRaw, 10)
      if (!Number.isFinite(month) || month < 1 || month > maxMonth) {
        return { status: 400, data: { error: 'Invalid month' } }
      }
    }
    if ((year !== undefined) !== (month !== undefined)) {
      return {
        status: 400,
        data: { error: 'Both year and month are required for a specific period' },
      }
    }

    const result = await generateMonthlyStatements(ctx!.organizationId, year, month)
    return { data: result }
  },
})
