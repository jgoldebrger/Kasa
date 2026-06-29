import { handler } from '@/lib/api/handler'
import { checkRateLimit } from '@/lib/rate-limit'
import { fetchFamilyTree } from '@/lib/family-sub-tree'

export const dynamic = 'force-dynamic'

// GET — nested household tree (ancestors + descendants via parentFamilyId).
export const GET = handler({
  auth: 'org',
  idParams: ['id'],
  name: 'GET /api/families/[id]/sub-families/tree',
  fn: async ({ params, ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'family-sub-family-tree',
      { limit: 60, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const id = params.id as string
    const tree = await fetchFamilyTree(ctx!.organizationId, id)
    if (!tree) {
      return { status: 404, data: { error: 'Family not found' } }
    }

    return { data: tree }
  },
})
