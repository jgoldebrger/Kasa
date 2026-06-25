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

    const [total, sent, failed, opened, clicked, messageRows] = await Promise.all([
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
      EmailMessage.find(filter)
        .select('events')
        .lean<{ events?: Array<{ type?: string; meta?: { url?: string } }> }[]>(),
    ])

    const urlCounts = new Map<string, number>()
    for (const row of messageRows) {
      for (const ev of row.events ?? []) {
        if (ev.type === 'clicked' && ev.meta?.url) {
          const url = String(ev.meta.url)
          urlCounts.set(url, (urlCounts.get(url) ?? 0) + 1)
        }
      }
    }
    const topLinks = [...urlCounts.entries()]
      .map(([url, count]) => ({ url, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)

    return { data: { sent, failed, opened, clicked, total, topLinks } }
  },
})
