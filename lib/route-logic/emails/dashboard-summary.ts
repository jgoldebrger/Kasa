import { Types } from 'mongoose'
import { EmailMessage, ScheduledEmail } from '@/lib/models'

export interface EmailDashboardSummary {
  failedLast7Days: number
  lastSentAt: Date | null
  pendingScheduled: number
}

export async function getEmailDashboardSummary(
  organizationId: string,
): Promise<EmailDashboardSummary> {
  const orgOid = new Types.ObjectId(organizationId)
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const [failedLast7Days, lastSent, pendingScheduled] = await Promise.all([
    EmailMessage.countDocuments({
      organizationId: orgOid,
      status: 'failed',
      createdAt: { $gte: since },
    }),
    EmailMessage.findOne({
      organizationId: orgOid,
      status: { $in: ['sent', 'opened', 'clicked'] },
    })
      .sort({ createdAt: -1 })
      .select('createdAt')
      .lean<{ createdAt?: Date }>(),
    ScheduledEmail.countDocuments({
      organizationId: orgOid,
      status: 'pending',
      scheduledFor: { $gte: new Date() },
    }),
  ])

  return {
    failedLast7Days,
    lastSentAt: lastSent?.createdAt ?? null,
    pendingScheduled,
  }
}
