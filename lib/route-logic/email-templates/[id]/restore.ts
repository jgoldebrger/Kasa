import { Types } from 'mongoose'
import { audit } from '@/lib/audit'
import { restoreEmailTemplateVersion } from '@/lib/email-template-versions'
import { checkRateLimit } from '@/lib/rate-limit'
import { emailTemplate as emailTemplateSchemas } from '@/lib/schemas'
import { handler } from '@/lib/api/handler'

export const dynamic = 'force-dynamic'

export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  body: emailTemplateSchemas.emailTemplateRestoreBody,
  name: 'POST /api/email-templates/[id]/restore',
  fn: async ({ ctx, params, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'email-templates-restore',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const id = params.id as string
    if (!Types.ObjectId.isValid(id)) {
      return { status: 400, data: { error: 'Invalid template id' } }
    }

    const restored = await restoreEmailTemplateVersion(
      id,
      body.versionId,
      ctx!.organizationId,
      ctx!.userId,
    )

    if (!restored) {
      return { status: 404, data: { error: 'Template or version not found' } }
    }

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'email_template.restore',
      resourceType: 'EmailTemplate',
      resourceId: id,
      metadata: { versionId: body.versionId, restoredFromVersion: restored.restoredFromVersion },
      request,
    })

    return { data: restored }
  },
})
