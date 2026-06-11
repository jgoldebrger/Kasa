import { Schema } from 'mongoose'

/**
 * Soft-delete plugin.
 *
 * Adds `deletedAt` / `deletedBy` / `deletedKind` to a schema and installs
 * a TTL index that hard-purges documents 30 days after they were soft-deleted.
 *
 * It also installs pre-hooks on every read & write operation so soft-deleted
 * rows are invisible to normal queries. Pass `{ includeDeleted: true }` in
 * the query options to opt-in to seeing trashed rows (the recycle bin
 * endpoints do this).
 *
 * Example bypass:
 *   await Family.find({ organizationId }, null, { includeDeleted: true })
 */
const RECYCLE_BIN_RETENTION_SECONDS = 60 * 60 * 24 * 30 // 30 days

export function softDeletePlugin(schema: Schema) {
  schema.add({
    deletedAt: { type: Date, default: null, index: true },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    deletedKind: { type: String, default: null }, // 'manual' | 'cascade'
  })

  // TTL purge — only fires on docs that have a real Date in `deletedAt`.
  schema.index(
    { deletedAt: 1 },
    {
      expireAfterSeconds: RECYCLE_BIN_RETENTION_SECONDS,
      partialFilterExpression: { deletedAt: { $type: 'date' } },
      name: 'recycle_bin_ttl',
    },
  )

  // Filter soft-deleted rows out of every default query. Routes that need
  // to see them pass `{ includeDeleted: true }` as a query option.
  const filterDeleted = function (this: any, next: () => void) {
    if (this.getOptions && this.getOptions().includeDeleted) return next()
    const conds = this.getFilter ? this.getFilter() : this.getQuery?.()
    if (conds && conds.deletedAt === undefined) {
      this.where({ deletedAt: null })
    }
    next()
  }

  schema.pre('find', filterDeleted as any)
  schema.pre('findOne', filterDeleted as any)
  schema.pre('findOneAndUpdate', filterDeleted as any)
  schema.pre('findOneAndDelete', filterDeleted as any)
  schema.pre('findOneAndReplace', filterDeleted as any)
  schema.pre('countDocuments', filterDeleted as any)
  schema.pre('count', filterDeleted as any)
  schema.pre('updateOne', filterDeleted as any)
  schema.pre('updateMany', filterDeleted as any)
  schema.pre('deleteOne', filterDeleted as any)
  schema.pre('deleteMany', filterDeleted as any)
  schema.pre('distinct', filterDeleted as any)

  // Aggregate: prepend a $match stage that hides deleted docs unless the
  // aggregation explicitly opts in via `aggregate(..., { includeDeleted: true })`.
  schema.pre('aggregate', function (this: any, next: () => void) {
    if (this.options && this.options.includeDeleted) return next()
    this.pipeline().unshift({ $match: { deletedAt: null } })
    next()
  })
}
