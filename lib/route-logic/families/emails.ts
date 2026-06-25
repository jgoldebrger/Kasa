import { Family } from '@/lib/models'
import { email as emailSchemas } from '@/lib/schemas'
import { handler } from '@/lib/api/handler'
import { hasMinRole } from '@/lib/auth-helpers'
import { checkMemberFamilyFinancialAccess } from '@/lib/member-family-access.server'
import { listOrgEmails } from '@/lib/route-logic/emails/list'

export const GET = handler({
  auth: 'org',
  minRole: 'member',
  idParams: ['id'],
  query: emailSchemas.listEmailsQuery,
  name: 'GET /api/families/[id]/emails',
  fn: async ({ ctx, params, query }) => {
    const familyId = String(params.id)
    const family = await Family.findOne({
      _id: familyId,
      organizationId: ctx!.organizationId,
    })
    if (!family) return { status: 404, data: { error: 'Family not found' } }

    if (!hasMinRole(ctx!.role, 'admin')) {
      const access = await checkMemberFamilyFinancialAccess(
        ctx!.organizationId,
        familyId,
        ctx!.userId,
        ctx!.role,
      )
      if (!access.allowed) {
        return { status: 403, data: { error: 'Access denied for this family' } }
      }
    }

    const data = await listOrgEmails(ctx!.organizationId, { ...query, familyId })
    return { data }
  },
})
