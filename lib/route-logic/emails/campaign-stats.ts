import { Types } from 'mongoose'
import { EmailMessage } from '@/lib/models'
import { checkRateLimit } from '@/lib/rate-limit'
import { handler } from '@/lib/api/handler'

export const dynamic = 'force-dynamic'

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['campaignId'],
  name: 'GET /api/emails/campaign/[campaignId]',
  fn: async ({ ctx, params, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'email-campaign-stats',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const campaignId = params.campaignId as string
    if (!Types.ObjectId.isValid(campaignId)) {
      return { status: 400, data: { error: 'Invalid campaign id' } }
    }

    const filter = {
      organizationId: new Types.ObjectId(ctx!.organizationId),
      campaignId: new Types.ObjectId(campaignId),
    }

    const [total, sent, failed, opened, clicked] = await Promise.all([
      EmailMessage.countDocuments(filter),
      EmailMessage.countDocuments({ ...filter, status: { $in: ['sent', 'opened', 'clicked'] } }),
      EmailMessage.countDocuments({ ...filter, status: 'failed' }),
      EmailMessage.countDocuments({
        ...filter,
        $or: [{ status: 'opened' }, { status: 'clicked' }, { openCount: { $gt: 0 } }],
      }),
      EmailMessage.countDocuments({
        ...filter,
        $or: [{ status: 'clicked' }, { clickCount: { $gt: 0 } }],
      }),
    ])

    return { data: { sent, failed, opened, clicked, total } }
  },
})
