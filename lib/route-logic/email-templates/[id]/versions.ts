import { Types } from 'mongoose'
import { EmailTemplate } from '@/lib/models'
import { listEmailTemplateVersions } from '@/lib/email-template-versions'
import { checkRateLimit } from '@/lib/rate-limit'
import { handler } from '@/lib/api/handler'

export const dynamic = 'force-dynamic'

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  name: 'GET /api/email-templates/[id]/versions',
  fn: async ({ ctx, params, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'email-templates-versions-list',
      { limit: 60, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const id = params.id as string
    if (!Types.ObjectId.isValid(id)) {
      return { status: 400, data: { error: 'Invalid template id' } }
    }

    const template = await EmailTemplate.findOne({
      _id: id,
      organizationId: ctx!.organizationId,
    })
      .select('_id')
      .lean()

    if (!template) return { status: 404, data: { error: 'Template not found' } }

    const versions = await listEmailTemplateVersions(id, ctx!.organizationId, 10)

    return { data: { versions } }
  },
})
