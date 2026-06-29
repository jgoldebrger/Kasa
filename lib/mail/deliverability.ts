import { Types } from 'mongoose'
import { EmailMessage, Family } from '@/lib/models'

const DELIVERY_FAILURE_STATUSES = ['failed', 'bounced'] as const

function emailRegexFor(normalized: string): RegExp {
  return new RegExp(`^${normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
}

export async function clearDeliverabilityWarning(
  organizationId: string,
  to: string,
): Promise<void> {
  const normalized = to.trim().toLowerCase()
  if (!normalized) return
  await Family.updateMany(
    {
      organizationId: new Types.ObjectId(organizationId),
      email: { $regex: emailRegexFor(normalized) },
    },
    { $set: { emailDeliverabilityWarning: false } },
  )
}

/** Flag matching families when an address has 3+ delivery failures in 7 days. */
export async function trackDeliverabilityFailure(
  organizationId: string,
  to: string,
): Promise<void> {
  const normalized = to.trim().toLowerCase()
  if (!normalized) return
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const failureCount = await EmailMessage.countDocuments({
    organizationId: new Types.ObjectId(organizationId),
    to: { $regex: emailRegexFor(normalized) },
    status: { $in: DELIVERY_FAILURE_STATUSES },
    createdAt: { $gte: sevenDaysAgo },
  })
  if (failureCount >= 3) {
    await Family.updateMany(
      {
        organizationId: new Types.ObjectId(organizationId),
        email: { $regex: emailRegexFor(normalized) },
      },
      { $set: { emailDeliverabilityWarning: true } },
    )
  }
}
