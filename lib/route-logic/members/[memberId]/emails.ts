import { handler } from '@/lib/api/handler'
import { hasMinRole } from '@/lib/auth-helpers'
import { checkMemberFamilyFinancialAccess } from '@/lib/member-family-access.server'
import { checkRateLimit } from '@/lib/rate-limit'
import { listOrgEmails } from '@/lib/route-logic/emails/list'

export const dynamic = 'force-dynamic'

export const GET = handler({
  auth: 'org',
  minRole: 'member',
  idParams: ['memberId'],
  name: 'GET /api/members/[memberId]/emails',
  fn: async ({ params, ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'member-emails',
      { limit: 60, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const { FamilyMember } = await import('@/lib/models')
    const member = await FamilyMember.findOne({
      _id: params.memberId,
      organizationId: ctx!.organizationId,
    })
    if (!member) {
      return { status: 404, data: { error: 'Member not found' } }
    }

    const familyId = String(member.familyId)
    if (!hasMinRole(ctx!.role, 'admin')) {
      const access = await checkMemberFamilyFinancialAccess(
        ctx!.organizationId,
        familyId,
        ctx!.userId,
        ctx!.role,
      )
      if (!access.allowed) {
        return { status: 403, data: { error: 'Access denied for this member' } }
      }
    }

    const data = await listOrgEmails(ctx!.organizationId, {
      familyId,
      limit: 50,
    })

    return { data }
  },
})
