import { DunningEpisode } from '@/lib/models'
import { calendarDaysBetween } from './qualify'
import type { DunningClosedReason, DunningEpisodeStatus } from './types'

export type DunningRuleCadence = {
  _id: { toString(): string }
  maxAttempts: number
  intervalDays: number
}

type PlanArgs = {
  organizationId: string
  familyId: string
  rule: DunningRuleCadence
  qualifies: boolean
  now: Date
  timezone: string | null | undefined
}

type PlanResult =
  | { action: 'skip' }
  | { action: 'close'; reason: DunningClosedReason }
  | { action: 'send'; episodeId: string }

type EpisodeIds = { organizationId: string; familyId: string; ruleId: string }

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 11000
}

function intervalElapsed(
  from: Date | null | undefined,
  now: Date,
  intervalDays: number,
  timezone: string | null | undefined,
): boolean {
  if (!from) return true
  return calendarDaysBetween(from, now, timezone) >= intervalDays
}

function findOpenEpisode(ids: EpisodeIds) {
  return DunningEpisode.findOne({ ...ids, status: 'open' })
}

function findLatestEpisodeDoc(ids: EpisodeIds) {
  return DunningEpisode.findOne(ids).sort({ createdAt: -1, _id: -1 })
}

type ClosableEpisode = {
  _id: { toString(): string }
  sendCount: number
  lastSentAt: Date | null
  status: string
  closedReason: DunningClosedReason | null
  closedAt: Date | null
  save: () => Promise<unknown>
}

async function persistClose(
  episode: ClosableEpisode,
  reason: DunningClosedReason,
  now: Date,
): Promise<void> {
  episode.status = 'closed'
  episode.closedReason = reason
  episode.closedAt = now
  await episode.save()
}

async function planForOpenEpisode(
  episode: ClosableEpisode,
  rule: DunningRuleCadence,
  now: Date,
  timezone: string | null | undefined,
): Promise<PlanResult> {
  if (episode.sendCount >= rule.maxAttempts) {
    await persistClose(episode, 'max_attempts', now)
    return { action: 'close', reason: 'max_attempts' }
  }
  if (intervalElapsed(episode.lastSentAt, now, rule.intervalDays, timezone)) {
    return { action: 'send', episodeId: episode._id.toString() }
  }
  return { action: 'skip' }
}

async function createOpenAndSend(
  ids: EpisodeIds,
  rule: DunningRuleCadence,
  now: Date,
  timezone: string | null | undefined,
) {
  try {
    const created = await DunningEpisode.create({
      organizationId: ids.organizationId,
      familyId: ids.familyId,
      ruleId: ids.ruleId,
      status: 'open',
      sendCount: 0,
    })
    return { action: 'send' as const, episodeId: String(created._id) }
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err
    const open = await findOpenEpisode(ids)
    if (!open) throw err
    return planForOpenEpisode(open, rule, now, timezone)
  }
}

async function planNewOrReentry(
  ids: EpisodeIds,
  rule: DunningRuleCadence,
  now: Date,
  timezone: string | null | undefined,
) {
  const latest = await findLatestEpisodeDoc(ids)
  const quietFrom = latest?.lastSentAt ?? latest?.closedAt ?? null
  if (latest && !intervalElapsed(quietFrom, now, rule.intervalDays, timezone)) {
    return { action: 'skip' as const }
  }
  return createOpenAndSend(ids, rule, now, timezone)
}

export async function latestEpisode(args: {
  organizationId: string
  familyId: string
  ruleId: string
}): Promise<{
  status: DunningEpisodeStatus
  sendCount: number
  lastSentAt: Date | null
  closedAt: Date | null
} | null> {
  const doc = await findLatestEpisodeDoc(args)
  if (!doc) return null
  return {
    status: doc.status as DunningEpisodeStatus,
    sendCount: doc.sendCount,
    lastSentAt: doc.lastSentAt ?? null,
    closedAt: doc.closedAt ?? null,
  }
}

export async function closeDunningEpisodesForPayment(args: {
  organizationId: string
  familyId: string
}): Promise<number> {
  const now = new Date()
  const result = await DunningEpisode.updateMany(
    { organizationId: args.organizationId, familyId: args.familyId, status: 'open' },
    { $set: { status: 'closed', closedReason: 'payment', closedAt: now } },
  )
  return result.modifiedCount
}

export async function recordSuccessfulDunningSend(args: {
  episodeId: string
  now: Date
  maxAttempts: number
}): Promise<void> {
  const episode = await DunningEpisode.findById(args.episodeId)
  if (!episode) throw new Error('Dunning episode not found')
  episode.sendCount += 1
  episode.lastSentAt = args.now
  if (episode.sendCount >= args.maxAttempts) {
    episode.status = 'closed'
    episode.closedReason = 'max_attempts'
    episode.closedAt = args.now
  }
  await episode.save()
}

export async function planDunningAction(args: PlanArgs): Promise<PlanResult> {
  const ids = {
    organizationId: args.organizationId,
    familyId: args.familyId,
    ruleId: args.rule._id.toString(),
  }
  const open = await findOpenEpisode(ids)
  if (!args.qualifies) {
    if (!open) return { action: 'skip' }
    await persistClose(open, 'no_longer_qualifies', args.now)
    return { action: 'close', reason: 'no_longer_qualifies' }
  }
  if (open) return planForOpenEpisode(open, args.rule, args.now, args.timezone)
  return planNewOrReentry(ids, args.rule, args.now, args.timezone)
}
