import { z } from 'zod'
import { handler } from '@/lib/api/handler'
import { objectId } from '@/lib/schemas/common'
import { checkRateLimit } from '@/lib/rate-limit'
import { getFamilyMergePreview, mergeFamilies } from '@/lib/family-merge'

export const dynamic = 'force-dynamic'

const mergeBody = z.object({
  sourceFamilyId: objectId,
  targetFamilyId: objectId,
})

const previewQuery = z.object({
  sourceFamilyId: objectId,
  targetFamilyId: objectId,
})

// GET /api/families/merge/preview?sourceFamilyId=&targetFamilyId=
export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  query: previewQuery,
  name: 'GET /api/families/merge/preview',
  fn: async ({ ctx, query, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'families-merge-preview',
      { limit: 60, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const result = await getFamilyMergePreview(
      ctx!.organizationId,
      query.sourceFamilyId,
      query.targetFamilyId,
    )
    if (!result.ok) {
      return { status: 400, data: { error: result.error } }
    }
    return { data: result.preview }
  },
})

// POST /api/families/merge — move records to target and archive source.
export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  body: mergeBody,
  name: 'POST /api/families/merge',
  fn: async ({ ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'families-merge',
      { limit: 20, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const result = await mergeFamilies(
      ctx!.organizationId,
      body.sourceFamilyId,
      body.targetFamilyId,
      ctx!,
      { request },
    )
    if (!result.ok) {
      return { status: 400, data: { error: result.error } }
    }
    return { data: result.result }
  },
})
