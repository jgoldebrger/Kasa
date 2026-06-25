import { Types } from 'mongoose'
import { EmailMessage } from '@/lib/models'

export async function recordEmailOpen(emailMessageId: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(emailMessageId)) return false
  const doc = await EmailMessage.findById(emailMessageId).select('status firstOpenedAt')
  if (!doc) return false

  const now = new Date()
  const $set: Record<string, unknown> = {}
  if (!doc.firstOpenedAt) $set.firstOpenedAt = now
  if (doc.status === 'sent' || doc.status === 'queued') $set.status = 'opened'

  await EmailMessage.updateOne(
    { _id: emailMessageId },
    {
      ...(Object.keys($set).length ? { $set } : {}),
      $inc: { openCount: 1 },
      $push: { events: { type: 'opened', at: now } },
    },
  )
  return true
}

export async function recordEmailClick(
  emailMessageId: string,
  targetUrl: string,
): Promise<boolean> {
  if (!Types.ObjectId.isValid(emailMessageId)) return false
  const doc = await EmailMessage.findById(emailMessageId).select('status firstClickedAt')
  if (!doc) return false

  const now = new Date()
  const $set: Record<string, unknown> = { status: 'clicked' }
  if (!doc.firstClickedAt) $set.firstClickedAt = now

  await EmailMessage.updateOne(
    { _id: emailMessageId },
    {
      $set,
      $inc: { clickCount: 1 },
      $push: { events: { type: 'clicked', at: now, meta: { url: targetUrl } } },
    },
  )
  return true
}
