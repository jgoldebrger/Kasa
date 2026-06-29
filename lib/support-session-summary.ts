import { Types } from 'mongoose'
import { AuditLog } from '@/lib/models'

const EXCLUDED_ACTIONS = ['platform.impersonate.start', 'platform.impersonate.end'] as const
const MAX_ACTIONS = 50

export type SupportSessionAction = {
  action: string
  at: string
}

export type SupportSessionDetail = {
  id: string
  startedAt: string
  endedAt: string | null
  userId: string
  organizationId: string
  reason: string | null
  readOnly: boolean | null
}

function readSessionMetadata(metadata: unknown): {
  reason: string | null
  readOnly: boolean | null
} {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { reason: null, readOnly: null }
  }
  const record = metadata as Record<string, unknown>
  return {
    reason: typeof record.reason === 'string' ? record.reason : null,
    readOnly: record.readOnly === true ? true : record.readOnly === false ? false : null,
  }
}

async function findSessionEndAt(
  organizationId: Types.ObjectId,
  userId: Types.ObjectId,
  startedAt: Date,
): Promise<Date | null> {
  const end = await AuditLog.findOne({
    organizationId,
    userId,
    action: 'platform.impersonate.end',
    createdAt: { $gt: startedAt },
  })
    .sort({ createdAt: 1 })
    .select('createdAt')
    .lean<{ createdAt: Date }>()

  return end?.createdAt ?? null
}

async function querySessionActions(
  organizationId: Types.ObjectId,
  userId: Types.ObjectId,
  startedAt: Date,
  endedAt: Date | null,
): Promise<SupportSessionAction[]> {
  const createdAt = endedAt ? { $gte: startedAt, $lte: endedAt } : { $gte: startedAt }

  const rows = await AuditLog.find({
    organizationId,
    userId,
    createdAt,
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

/** Audit actions performed during an active support session (newest last, capped). */
export async function getSupportSessionActions(
  userId: string,
  organizationId: string,
  startedAtSec: number,
): Promise<SupportSessionAction[]> {
  return querySessionActions(
    new Types.ObjectId(organizationId),
    new Types.ObjectId(userId),
    new Date(startedAtSec * 1000),
    null,
  )
}

/** Session detail and actions for a support-audit start entry id. */
export async function getSupportSessionByStartId(sessionId: string): Promise<{
  session: SupportSessionDetail | null
  actions: SupportSessionAction[]
}> {
  if (!Types.ObjectId.isValid(sessionId)) {
    return { session: null, actions: [] }
  }

  const start = await AuditLog.findById(sessionId)
    .select('action organizationId userId createdAt metadata')
    .lean<{
      action: string
      organizationId: Types.ObjectId
      userId: Types.ObjectId
      createdAt: Date
      metadata?: unknown
    }>()

  if (!start || start.action !== 'platform.impersonate.start') {
    return { session: null, actions: [] }
  }

  const startedAt = new Date(start.createdAt)
  const endedAt = await findSessionEndAt(start.organizationId, start.userId, startedAt)
  const { reason, readOnly } = readSessionMetadata(start.metadata)
  const actions = await querySessionActions(start.organizationId, start.userId, startedAt, endedAt)

  return {
    session: {
      id: sessionId,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt ? endedAt.toISOString() : null,
      userId: String(start.userId),
      organizationId: String(start.organizationId),
      reason,
      readOnly,
    },
    actions,
  }
}
