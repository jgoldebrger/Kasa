import { email as emailSchemas } from '@/lib/schemas'
import { handler } from '@/lib/api/handler'
import { listOrgEmails } from './list'

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  query: emailSchemas.listEmailsQuery,
  name: 'GET /api/emails',
  fn: async ({ ctx, query }) => {
    const data = await listOrgEmails(ctx!.organizationId, query)
    return { data }
  },
})
