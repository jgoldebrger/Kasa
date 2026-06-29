import { EmailAutomationRule } from '@/lib/models'
import { handler } from '@/lib/api/handler'
import { resolveAutomationRecipients } from '../resolve-recipients'

export const dynamic = 'force-dynamic'

export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  name: 'POST /api/email-automation-rules/[id]/preview',
  fn: async ({ ctx, params }) => {
    const rule = await EmailAutomationRule.findOne({
      _id: params.id,
      organizationId: ctx!.organizationId,
    }).lean<any>()

    if (!rule) {
      return { status: 404, data: { error: 'Email automation rule not found' } }
    }

    const preview = await resolveAutomationRecipients(ctx!.organizationId, rule.ruleType)
    return { data: preview }
  },
})
