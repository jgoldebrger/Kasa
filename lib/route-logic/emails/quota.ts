import { checkRateLimit } from '@/lib/rate-limit'
import { handler } from '@/lib/api/handler'
import { getDailySendLimit, getTodaySentCount } from '@/lib/mail/daily-send-quota'

export const dynamic = 'force-dynamic'

export async function getEmailQuota(organizationId: string) {
  const limit = getDailySendLimit()
  const sentToday = await getTodaySentCount(organizationId)
  return {
    sentToday,
    limit,
    remaining: Math.max(0, limit - sentToday),
  }
}

export const GET = handler({
  auth: 'org',
  minRole: 'admin',
  name: 'GET /api/emails/quota',
  fn: async ({ ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'email-quota',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const quota = await getEmailQuota(ctx!.organizationId)
    return { data: quota }
  },
})
