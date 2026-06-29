import { z } from 'zod'
import { EmailMessage } from '@/lib/models'
import { trackDeliverabilityFailure } from '@/lib/mail/deliverability'
import { handler } from '@/lib/api/handler'
import { objectId } from '@/lib/schemas/common'

export const dynamic = 'force-dynamic'

const bounceBody = z.object({
  emailMessageId: objectId,
  reason: z.string().max(2000).optional(),
})

export function verifyBounceWebhookSecret(request: Request): boolean {
  const secret = process.env.EMAIL_BOUNCE_WEBHOOK_SECRET?.trim()
  if (!secret) return false
  const header = request.headers.get('x-webhook-secret')
  return Boolean(header && header === secret)
}

export const POST = handler({
  auth: 'public',
  body: bounceBody,
  name: 'POST /api/email/bounce',
  fn: async ({ body, request }) => {
    if (!verifyBounceWebhookSecret(request)) {
      return { status: 401, data: { error: 'Unauthorized' } }
    }

    const row = await EmailMessage.findById(body.emailMessageId).lean<{
      _id: unknown
      organizationId: { toString(): string }
      to: string
      status: string
    }>()

    if (!row) {
      return { status: 404, data: { error: 'Email message not found' } }
    }

    if (row.status === 'bounced') {
      return { data: { ok: true, emailMessageId: String(row._id), status: 'bounced' } }
    }

    const reason = body.reason?.trim() || undefined

    await EmailMessage.updateOne(
      { _id: row._id },
      {
        $set: {
          status: 'bounced',
          ...(reason ? { error: reason } : {}),
        },
        $push: {
          events: {
            type: 'bounced',
            at: new Date(),
            ...(reason ? { meta: { reason } } : {}),
          },
        },
      },
    )

    void trackDeliverabilityFailure(String(row.organizationId), row.to)

    return { data: { ok: true, emailMessageId: String(row._id), status: 'bounced' } }
  },
})
