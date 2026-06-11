import { Types } from 'mongoose'
import { handler } from '@/lib/api/handler'
import { FamilyMember } from '@/lib/models'
import { UNBOUNDED_LIST_CAP } from '@/lib/schemas'
import { checkRateLimit } from '@/lib/rate-limit'
import { loadAllByIdCursor } from '@/lib/org-pagination'

/**
 * Returns every family member for the active organization in one shot,
 * grouped by familyId. Replaces the previous pattern of doing
 *   await Promise.all(families.map(f => fetch(`/.../${f._id}/members`)))
 * which was a hard N+1 (one HTTP request per family) on the Tasks page
 * and Statements page.
 *
 * Accepts optional ?limit=&cursor= for paginated reads. When unspecified
 * the legacy shape is preserved (full byFamily map, no cursor).
 */
export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/family-members/all',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'family-members-all',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const { searchParams } = new URL(request.url)
    const limitParam = searchParams.get('limit')
    const cursorParam = searchParams.get('cursor')
    let clientLimit = 0
    if (limitParam) {
      const n = parseInt(limitParam, 10)
      if (Number.isFinite(n) && n > 0) clientLimit = Math.min(n, 500)
    }
    const effectiveLimit = clientLimit > 0 ? clientLimit : UNBOUNDED_LIST_CAP

    const baseFilter: Record<string, unknown> = {
      organizationId: ctx!.organizationId,
      convertedToFamily: { $ne: true },
    }

    let nextCursor: string | null = null
    let members: any[]

    if (clientLimit > 0) {
      const filter: Record<string, unknown> = { ...baseFilter }
      if (cursorParam) {
        if (!/^[a-f0-9]{24}$/i.test(cursorParam) || !Types.ObjectId.isValid(cursorParam)) {
          return { status: 400, data: { error: 'Invalid cursor' } }
        }
        filter._id = { $gt: new Types.ObjectId(cursorParam) }
      }

      const rows = await FamilyMember.find(filter)
        .select('_id familyId firstName lastName birthDate gender')
        .sort({ _id: 1 })
        .limit(effectiveLimit + 1)
        .lean<any[]>()

      members = rows
      if (rows.length > effectiveLimit) {
        members = rows.slice(0, effectiveLimit)
        nextCursor = String(members[members.length - 1]?._id ?? '')
      }
    } else {
      members = await loadAllByIdCursor<any>(
        (filter, limit) =>
          FamilyMember.find(filter)
            .select('_id familyId firstName lastName birthDate gender')
            .sort({ _id: 1 })
            .limit(limit)
            .lean<any[]>(),
        baseFilter,
      )
    }

    // Group by familyId. Keep payload compact — clients only ever want
    // a list of {id, name} pairs from this endpoint.
    const byFamily: Record<string, any[]> = {}
    for (const m of members) {
      const key = String(m.familyId)
      if (!byFamily[key]) byFamily[key] = []
      byFamily[key].push({
        _id: m._id?.toString(),
        firstName: m.firstName,
        lastName: m.lastName,
        birthDate: m.birthDate,
        gender: m.gender,
      })
    }

    const body = clientLimit > 0 ? { byFamily, nextCursor } : { byFamily }
    return {
      data: body,
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=300' },
    }
  },
})
