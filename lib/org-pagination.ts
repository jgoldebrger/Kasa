/**
 * Cursor-based batch iteration for org-scoped Mongo collections.
 * Avoids silently truncating at UNBOUNDED_LIST_CAP when an org has more
 * than 1000 families/members.
 */

import { Types } from 'mongoose'
import { Family, FamilyMember } from './models'
import { UNBOUNDED_LIST_CAP } from './schemas/common'

export type BatchOptions = {
  batchSize?: number
  select?: string
}

/** Load all matching docs via stable _id cursor pagination. */
export async function loadAllByIdCursor<T extends { _id: unknown }>(
  loadBatch: (filter: Record<string, unknown>, limit: number) => Promise<T[]>,
  baseFilter: Record<string, unknown>,
  batchSize = UNBOUNDED_LIST_CAP,
): Promise<T[]> {
  const out: T[] = []
  let afterId: Types.ObjectId | null = null
  for (;;) {
    const filter: Record<string, unknown> = { ...baseFilter }
    if (afterId) filter._id = { $gt: afterId }
    const batch = await loadBatch(filter, batchSize)
    out.push(...batch)
    if (batch.length < batchSize) break
    afterId = new Types.ObjectId(String(batch[batch.length - 1]._id))
  }
  return out
}

/** Fetch documents whose `_id` is in `ids`, in chunks (Mongo `$in` limit safety). */
export async function loadByIdsInChunks<T>(
  loadChunk: (ids: Types.ObjectId[]) => Promise<T[]>,
  ids: string[],
  batchSize = UNBOUNDED_LIST_CAP,
): Promise<T[]> {
  if (ids.length === 0) return []
  const out: T[] = []
  for (let i = 0; i < ids.length; i += batchSize) {
    const chunk = ids.slice(i, i + batchSize).map((id) => new Types.ObjectId(id))
    out.push(...(await loadChunk(chunk)))
  }
  return out
}

async function* idSortedBatches<T extends { _id: Types.ObjectId | string }>(
  load: (
    filter: Record<string, unknown>,
    limit: number,
  ) => Promise<T[]>,
  baseFilter: Record<string, unknown>,
  opts: BatchOptions = {},
): AsyncGenerator<T[]> {
  const batchSize = opts.batchSize ?? UNBOUNDED_LIST_CAP
  let afterId: Types.ObjectId | null = null

  for (;;) {
    const filter: Record<string, unknown> = { ...baseFilter }
    if (afterId) filter._id = { $gt: afterId }
    const batch = await load(filter, batchSize)
    if (batch.length === 0) return
    yield batch
    if (batch.length < batchSize) return
    afterId = new Types.ObjectId(String(batch[batch.length - 1]._id))
  }
}

export type FamilyBatchOptions = BatchOptions & {
  extraFilter?: Record<string, unknown>
}

/** Yield family docs for an org in stable _id order. */
export async function* familyBatches(
  organizationId: string,
  opts: FamilyBatchOptions = {},
): AsyncGenerator<Array<{ _id: Types.ObjectId; name?: string; paymentPlanId?: unknown }>> {
  const { extraFilter, ...batchOpts } = opts
  yield* idSortedBatches(
    async (filter, limit) => {
      let q = Family.find(filter).sort({ _id: 1 }).limit(limit)
      if (batchOpts.select) q = q.select(batchOpts.select)
      return q.lean()
    },
    { organizationId, ...(extraFilter ?? {}) },
    batchOpts,
  )
}

/** Families with a non-empty email that have not opted out of bulk mail. */
export const EMailableFamilyFilter: Record<string, unknown> = {
  emailOptOut: { $ne: true },
  $and: [
    { email: { $exists: true } },
    { email: { $ne: null } },
    { email: { $ne: '' } },
  ],
}

/** Yield family-member docs matching `extraFilter` in stable _id order. */
export async function* familyMemberBatches(
  organizationId: string,
  extraFilter: Record<string, unknown>,
  opts: BatchOptions = {},
): AsyncGenerator<Array<{ _id: Types.ObjectId | string; [key: string]: unknown }>> {
  yield* idSortedBatches<{ _id: Types.ObjectId | string; [key: string]: unknown }>(
    async (filter, limit) => {
      let q = FamilyMember.find(filter).sort({ _id: 1 }).limit(limit)
      if (opts.select) q = q.select(opts.select)
      return q.lean<Array<{ _id: Types.ObjectId | string; [key: string]: unknown }>>()
    },
    { organizationId, ...extraFilter },
    opts,
  )
}
