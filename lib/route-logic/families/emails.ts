import { Family } from '@/lib/models'
import { email as emailSchemas } from '@/lib/schemas'
import { handler } from '@/lib/api/handler'
import { listOrgEmails } from '@/lib/route-logic/emails/list'

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
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

    const data = await listOrgEmails(ctx!.organizationId, { ...query, familyId })
    return { data }
  },
})
