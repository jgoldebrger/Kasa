import { Types } from 'mongoose'
import { EmailMessage } from '@/lib/models'

const SENT_STATUSES = ['sent', 'opened', 'clicked'] as const

export function getDailySendLimit(): number {
  const parsed = parseInt(process.env.GMAIL_DAILY_LIMIT || '450', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 450
}

function startOfUtcDay(date = new Date()): Date {
  const d = new Date(date)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

/** Count outbound emails that reached SMTP today for an org. */
export async function getTodaySentCount(organizationId: string): Promise<number> {
  return EmailMessage.countDocuments({
    organizationId: new Types.ObjectId(organizationId),
    status: { $in: [...SENT_STATUSES] },
    createdAt: { $gte: startOfUtcDay() },
  })
}

export async function checkDailySendQuota(
  organizationId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const limit = getDailySendLimit()
  const count = await getTodaySentCount(organizationId)
  if (count >= limit) {
    return {
      ok: false,
      error: `Daily send quota exceeded (${count}/${limit}). Try again tomorrow.`,
    }
  }
  return { ok: true }
}
