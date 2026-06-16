/**
 * Recycle bin — soft delete, restore, and purge for tenant-owned entities.
 *
 * Conventions:
 *   - Every recyclable model uses the `softDeletePlugin` in `lib/models.ts`,
 *     which adds `deletedAt`, `deletedBy`, `deletedKind`, a TTL index that
 *     auto-purges at 30 days, and pre-hooks that hide deleted rows from
 *     normal queries.
 *   - To see deleted rows we pass `{ includeDeleted: true }` as the query
 *     option (or, for `Model.aggregate`, the aggregate option).
 *   - All ops here are org-scoped — callers MUST pass an `OrgContext`.
 */

import { Types } from 'mongoose'
import {
  Family,
  FamilyMember,
  Payment,
  Statement,
  Task,
  LifecycleEvent,
  LifecycleEventPayment,
  PaymentPlan,
  Withdrawal,
  CycleCharge,
  RecurringPayment,
  SavedPaymentMethod,
} from './models'
import { audit } from './audit'
import type { OrgContext } from './auth-helpers'
import { netPaymentAmount } from './money'
import { scheduleYearlyCalculationRefreshForPayment } from './calculations'

export const RECYCLE_BIN_RETENTION_DAYS = 30

export type RecyclableKind =
  | 'family'
  | 'familyMember'
  | 'payment'
  | 'statement'
  | 'task'
  | 'lifecycleEvent'
  | 'lifecycleEventPayment'
  | 'paymentPlan'
  | 'withdrawal'
  | 'cycleCharge'

interface ModelMeta {
  model: any
  label: string
  pluralLabel: string
  describe: (doc: any) => string
}

export const RECYCLABLE_MODELS: Record<RecyclableKind, ModelMeta> = {
  family: {
    model: Family,
    label: 'Family',
    pluralLabel: 'Families',
    describe: (d) => d?.name || 'Unnamed family',
  },
  familyMember: {
    model: FamilyMember,
    label: 'Member',
    pluralLabel: 'Members',
    describe: (d) =>
      `${d?.firstName || ''} ${d?.lastName || ''}`.trim() || 'Unnamed member',
  },
  payment: {
    model: Payment,
    label: 'Payment',
    pluralLabel: 'Payments',
    describe: (d) => {
      const dt = d?.paymentDate ? new Date(d.paymentDate).toISOString().slice(0, 10) : ''
      const net = netPaymentAmount(d)
      return `$${net}${dt ? ' on ' + dt : ''}`
    },
  },
  statement: {
    model: Statement,
    label: 'Statement',
    pluralLabel: 'Statements',
    describe: (d) => d?.statementNumber || 'Statement',
  },
  task: {
    model: Task,
    label: 'Task',
    pluralLabel: 'Tasks',
    describe: (d) => d?.title || 'Untitled task',
  },
  lifecycleEvent: {
    model: LifecycleEvent,
    label: 'Event type',
    pluralLabel: 'Event types',
    describe: (d) => d?.name || d?.type || 'Event type',
  },
  lifecycleEventPayment: {
    model: LifecycleEventPayment,
    label: 'Lifecycle event',
    pluralLabel: 'Lifecycle events',
    describe: (d) => {
      const dt = d?.eventDate ? new Date(d.eventDate).toISOString().slice(0, 10) : ''
      return `${d?.eventType || 'event'}${dt ? ' — ' + dt : ''}`
    },
  },
  paymentPlan: {
    model: PaymentPlan,
    label: 'Payment plan',
    pluralLabel: 'Payment plans',
    describe: (d) => d?.name || 'Payment plan',
  },
  withdrawal: {
    model: Withdrawal,
    label: 'Withdrawal',
    pluralLabel: 'Withdrawals',
    describe: (d) => {
      const dt = d?.withdrawalDate ? new Date(d.withdrawalDate).toISOString().slice(0, 10) : ''
      return `$${d?.amount ?? 0}${dt ? ' on ' + dt : ''}`
    },
  },
  cycleCharge: {
    model: CycleCharge,
    label: 'Annual dues',
    pluralLabel: 'Annual dues',
    describe: (d) => {
      const dt = d?.chargeDate ? new Date(d.chargeDate).toISOString().slice(0, 10) : ''
      const cy = d?.cycleYear ? ` (cycle ${d.cycleYear})` : ''
      return `$${d?.amount ?? 0}${cy}${dt ? ' on ' + dt : ''}`
    },
  },
}

export const RECYCLABLE_KINDS = Object.keys(RECYCLABLE_MODELS) as RecyclableKind[]

export function isRecyclableKind(s: string): s is RecyclableKind {
  return Object.prototype.hasOwnProperty.call(RECYCLABLE_MODELS, s)
}

interface SoftDeleteOpts {
  kind?: 'manual' | 'cascade'
  at?: Date
  metadata?: Record<string, unknown>
  request?: Request
}

export async function softDeleteOne(
  kind: RecyclableKind,
  id: string,
  ctx: OrgContext,
  opts: SoftDeleteOpts = {},
) {
  const meta = RECYCLABLE_MODELS[kind]
  const at = opts.at || new Date()

  const doc = await meta.model.findOneAndUpdate(
    {
      _id: id,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    {
      $set: {
        deletedAt: at,
        deletedBy: ctx.userId,
        deletedKind: opts.kind || 'manual',
      },
    },
    { new: true, includeDeleted: true },
  )

  if (!doc) return null

  await audit({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: `${kind}.softDelete`,
    resourceType: meta.label,
    resourceId: doc._id,
    metadata: { ...opts.metadata, deletedKind: opts.kind || 'manual' },
    request: opts.request,
  })

  if (kind === 'payment') {
    scheduleYearlyCalculationRefreshForPayment(doc)
  }

  return doc
}

export async function softDeleteFamilyCascade(
  familyId: string,
  ctx: OrgContext,
  opts: { request?: Request } = {},
) {
  const at = new Date()
  const orgId = ctx.organizationId

  const fam = await Family.findOne({ _id: familyId, organizationId: orgId })
  if (!fam) return null

  const cascadeUpdate = {
    $set: { deletedAt: at, deletedBy: ctx.userId, deletedKind: 'cascade' },
  }
  const baseFilter = { organizationId: orgId, familyId, deletedAt: null }

  const [
    memberRes,
    paymentRes,
    statementRes,
    lifecycleRes,
    taskRes,
    withdrawalRes,
    cycleChargeRes,
    recurringRes,
    savedPmRes,
  ] = await Promise.all([
    FamilyMember.updateMany(baseFilter, cascadeUpdate),
    Payment.updateMany(baseFilter, cascadeUpdate),
    Statement.updateMany(baseFilter, cascadeUpdate),
    LifecycleEventPayment.updateMany(baseFilter, cascadeUpdate),
    Task.updateMany(
      { organizationId: orgId, relatedFamilyId: familyId, deletedAt: null },
      cascadeUpdate,
    ),
    Withdrawal.updateMany(baseFilter, cascadeUpdate),
    CycleCharge.updateMany(baseFilter, cascadeUpdate),
    RecurringPayment.updateMany(
      { organizationId: orgId, familyId, isActive: true },
      { $set: { isActive: false } },
    ),
    SavedPaymentMethod.updateMany(
      { organizationId: orgId, familyId, isActive: true },
      { $set: { isActive: false } },
    ),
  ])

  await Family.updateOne(
    { _id: familyId, organizationId: orgId, deletedAt: null },
    { $set: { deletedAt: at, deletedBy: ctx.userId, deletedKind: 'manual' } },
  )

  await audit({
    organizationId: orgId,
    userId: ctx.userId,
    action: 'family.softDelete',
    resourceType: 'Family',
    resourceId: familyId,
    metadata: {
      name: fam.name,
      cascade: {
        memberCount: memberRes.modifiedCount,
        paymentCount: paymentRes.modifiedCount,
        statementCount: statementRes.modifiedCount,
        lifecycleCount: lifecycleRes.modifiedCount,
        taskCount: taskRes.modifiedCount,
        withdrawalCount: withdrawalRes.modifiedCount,
        cycleChargeCount: cycleChargeRes.modifiedCount,
        recurringDeactivated: recurringRes.modifiedCount,
        savedPaymentMethodsDeactivated: savedPmRes.modifiedCount,
      },
    },
    request: opts.request,
  })

  return { family: fam, deletedAt: at }
}

export async function restoreFromBin(
  kind: RecyclableKind,
  id: string,
  ctx: OrgContext,
  opts: { request?: Request } = {},
) {
  const meta = RECYCLABLE_MODELS[kind]

  const doc = await meta.model.findOne(
    { _id: id, organizationId: ctx.organizationId, deletedAt: { $ne: null } },
    null,
    { includeDeleted: true },
  )
  if (!doc) return null

  const familyChildKinds: RecyclableKind[] = [
    'familyMember',
    'payment',
    'statement',
    'lifecycleEventPayment',
    'withdrawal',
    'cycleCharge',
  ]
  if (familyChildKinds.includes(kind) && doc.familyId) {
    const parent = await Family.findOne({
      _id: doc.familyId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    }).select('_id')
    if (!parent) {
      const err = new Error(
        'Cannot restore: parent family is still in the recycle bin. Restore the family first.',
      ) as Error & { code?: string }
      err.code = 'PARENT_FAMILY_DELETED'
      throw err
    }
  }

  const clearFields = { $set: { deletedAt: null, deletedBy: null, deletedKind: null } }

  await meta.model.updateOne(
    { _id: id, organizationId: ctx.organizationId },
    clearFields,
    { includeDeleted: true },
  )

  let cascadeRestored = 0
  if (kind === 'family' && doc.deletedAt) {
    const cascadeAt = doc.deletedAt

    const childFilter = (extra: Record<string, unknown> = {}) => ({
      organizationId: ctx.organizationId,
      familyId: id,
      deletedAt: cascadeAt,
      deletedKind: 'cascade',
      ...extra,
    })

    const [
      memberRes,
      paymentRes,
      statementRes,
      lifecycleRes,
      taskRes,
      withdrawalRes,
      cycleChargeRes,
    ] = await Promise.all([
      FamilyMember.updateMany(childFilter(), clearFields, { includeDeleted: true }),
      Payment.updateMany(childFilter(), clearFields, { includeDeleted: true }),
      Statement.updateMany(childFilter(), clearFields, { includeDeleted: true }),
      LifecycleEventPayment.updateMany(childFilter(), clearFields, { includeDeleted: true }),
      Task.updateMany(
        {
          organizationId: ctx.organizationId,
          relatedFamilyId: id,
          deletedAt: cascadeAt,
          deletedKind: 'cascade',
        },
        clearFields,
        { includeDeleted: true },
      ),
      Withdrawal.updateMany(childFilter(), clearFields, { includeDeleted: true }),
      CycleCharge.updateMany(childFilter(), clearFields, { includeDeleted: true }),
    ])
    cascadeRestored =
      memberRes.modifiedCount +
      paymentRes.modifiedCount +
      statementRes.modifiedCount +
      lifecycleRes.modifiedCount +
      taskRes.modifiedCount +
      withdrawalRes.modifiedCount +
      cycleChargeRes.modifiedCount
  }

  await audit({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: `${kind}.restore`,
    resourceType: meta.label,
    resourceId: doc._id,
    metadata: { cascadeRestored, name: meta.describe(doc) },
    request: opts.request,
  })

  if (kind === 'payment') {
    scheduleYearlyCalculationRefreshForPayment(doc)
  }

  return { doc, cascadeRestored }
}

export async function purgeFromBin(
  kind: RecyclableKind,
  id: string,
  ctx: OrgContext,
  opts: { request?: Request } = {},
) {
  const meta = RECYCLABLE_MODELS[kind]

  const doc = await meta.model.findOneAndDelete(
    { _id: id, organizationId: ctx.organizationId, deletedAt: { $ne: null } },
    { includeDeleted: true },
  )
  if (!doc) return null

  await audit({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: `${kind}.purge`,
    resourceType: meta.label,
    resourceId: doc._id,
    metadata: { name: meta.describe(doc) },
    request: opts.request,
  })

  return doc
}

export async function purgeAll(
  ctx: OrgContext,
  opts: { request?: Request } = {},
): Promise<Record<RecyclableKind, number>> {
  const counts = {} as Record<RecyclableKind, number>

  for (const kind of RECYCLABLE_KINDS) {
    const { model } = RECYCLABLE_MODELS[kind]
    const res = await model.deleteMany(
      { organizationId: ctx.organizationId, deletedAt: { $ne: null } },
      { includeDeleted: true },
    )
    counts[kind] = res.deletedCount || 0
  }

  await audit({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'recycleBin.purgeAll',
    resourceType: 'RecycleBin',
    metadata: { counts },
    request: opts.request,
  })

  return counts
}

export interface TrashItem {
  id: string
  kind: RecyclableKind
  label: string
  description: string
  deletedAt: string
  deletedBy: string | null
  deletedKind: 'manual' | 'cascade' | null
  purgesAt: string
  daysUntilPurge: number
}

const DEFAULT_TRASH_LIMIT_PER_KIND = 500

function toTrashItem(kind: RecyclableKind, d: any, now = Date.now()): TrashItem {
  const meta = RECYCLABLE_MODELS[kind]
  const retentionMs = RECYCLE_BIN_RETENTION_DAYS * 24 * 60 * 60 * 1000
  const deletedAtMs = new Date(d.deletedAt).getTime()
  const purgesAtMs = deletedAtMs + retentionMs
  return {
    id: d._id.toString(),
    kind,
    label: meta.label,
    description: meta.describe(d),
    deletedAt: new Date(d.deletedAt).toISOString(),
    deletedBy: d.deletedBy ? d.deletedBy.toString() : null,
    deletedKind: d.deletedKind || null,
    purgesAt: new Date(purgesAtMs).toISOString(),
    daysUntilPurge: Math.max(0, Math.ceil((purgesAtMs - now) / (1000 * 60 * 60 * 24))),
  }
}

export async function getTrashItem(
  kind: RecyclableKind,
  id: string,
  orgId: string,
): Promise<TrashItem | null> {
  if (!Types.ObjectId.isValid(orgId) || !Types.ObjectId.isValid(id)) return null
  const meta = RECYCLABLE_MODELS[kind]
  const doc = await meta.model
    .findOne({ _id: id, organizationId: orgId, deletedAt: { $ne: null } }, null, {
      includeDeleted: true,
    }).lean()
  if (!doc) return null
  return toTrashItem(kind, doc)
}

export async function listTrash(
  orgId: string,
  opts: { limitPerKind?: number } = {},
): Promise<{
  items: TrashItem[]
  countsByKind: Record<RecyclableKind, number>
  totalCount: number
}> {
  if (!Types.ObjectId.isValid(orgId)) {
    return { items: [], countsByKind: emptyCounts(), totalCount: 0 }
  }

  const limitPerKind = Math.min(
    500,
    Math.max(1, Math.floor(opts.limitPerKind ?? DEFAULT_TRASH_LIMIT_PER_KIND)),
  )
  const now = Date.now()
  const items: TrashItem[] = []
  const countsByKind = emptyCounts()

  for (const kind of RECYCLABLE_KINDS) {
    const meta = RECYCLABLE_MODELS[kind]
    const filter = { organizationId: orgId, deletedAt: { $ne: null } as any }
    const [totalForKind, docs] = await Promise.all([
      meta.model.countDocuments(filter, { includeDeleted: true } as any),
      meta.model
        .find(filter, null, { includeDeleted: true })
        .sort({ deletedAt: -1 })
        .limit(limitPerKind)
        .lean(),
    ])

    countsByKind[kind] = totalForKind

    for (const d of docs as any[]) {
      items.push(toTrashItem(kind, d, now))
    }
  }

  items.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1))

  const totalCount = Object.values(countsByKind).reduce((s, n) => s + n, 0)

  return {
    items,
    countsByKind,
    totalCount,
  }
}

function emptyCounts(): Record<RecyclableKind, number> {
  const out = {} as Record<RecyclableKind, number>
  for (const k of RECYCLABLE_KINDS) out[k] = 0
  return out
}
