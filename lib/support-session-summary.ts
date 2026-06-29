import { Types } from 'mongoose'
import { AuditLog } from '@/lib/models'

const EXCLUDED_ACTIONS = ['platform.impersonate.start', 'platform.impersonate.end'] as const
const MAX_ACTIONS = 50

export type SupportSessionAction = {
  action: string
  at: string
}

/** Audit actions performed during an active support session (newest last, capped). */
export async function getSupportSessionActions(
  userId: string,
  organizationId: string,
  startedAtSec: number,
): Promise<SupportSessionAction[]> {
  const startedAt = new Date(startedAtSec * 1000)
  const rows = await AuditLog.find({
    organizationId: new Types.ObjectId(organizationId),
    userId: new Types.ObjectId(userId),
    createdAt: { $gte: startedAt },
    action: { $nin: EXCLUDED_ACTIONS },
  })
    .sort({ createdAt: -1 })
    .limit(MAX_ACTIONS)
    .select('action createdAt')
    .lean<{ action: string; createdAt: Date }[]>()

  return rows
    .map((row) => ({
      action: row.action,
      at: new Date(row.createdAt).toISOString(),
    }))
    .reverse()
}
