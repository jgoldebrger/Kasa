import { Types } from 'mongoose'
import {
  Family,
  FamilyMember,
  Payment,
  LifecycleEventPayment,
  Withdrawal,
  CycleCharge,
  Statement,
  Task,
  SavedPaymentMethod,
  RecurringPayment,
} from '@/lib/models'
import { audit } from '@/lib/audit'
import type { OrgContext } from '@/lib/auth-helpers'
import { isFamilyDescendantOf } from '@/lib/family-sub-tree'
import { scheduleYearlyCalculationRefresh } from '@/lib/calculations'

export interface FamilyMergeCounts {
  members: number
  payments: number
  lifecycleEvents: number
  withdrawals: number
  cycleCharges: number
  cycleChargeConflicts: number
  statements: number
  tasks: number
  savedPaymentMethods: number
  recurringPayments: number
  subFamilies: number
}

export interface FamilyMergePreview {
  sourceFamily: { _id: string; name: string }
  targetFamily: { _id: string; name: string }
  counts: FamilyMergeCounts
  warnings: string[]
}

export interface FamilyMergeResult {
  ok: true
  preview: FamilyMergePreview
  moved: FamilyMergeCounts
}

const orgFamilyFilter = (orgId: string, familyId: string) => ({
  organizationId: new Types.ObjectId(orgId),
  familyId: new Types.ObjectId(familyId),
  deletedAt: null,
})

export async function validateFamilyMerge(
  organizationId: string,
  sourceId: string,
  targetId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (sourceId === targetId) {
    return { ok: false, error: 'Cannot merge a family into itself' }
  }

  const [source, target] = await Promise.all([
    Family.findOne({ _id: sourceId, organizationId }).select('_id name').lean(),
    Family.findOne({ _id: targetId, organizationId }).select('_id name').lean(),
  ])

  if (!source) return { ok: false, error: 'Source family not found' }
  if (!target) return { ok: false, error: 'Target family not found' }

  if (await isFamilyDescendantOf(organizationId, sourceId, targetId)) {
    return {
      ok: false,
      error: 'Cannot merge into a sub-family of the source household',
    }
  }

  return { ok: true }
}

async function countCycleChargeConflicts(
  organizationId: string,
  sourceId: string,
  targetId: string,
): Promise<number> {
  const sourceCharges = await CycleCharge.find(orgFamilyFilter(organizationId, sourceId))
    .select('cycleYear')
    .lean<Array<{ cycleYear: number }>>()
  if (sourceCharges.length === 0) return 0

  const years = [...new Set(sourceCharges.map((c) => c.cycleYear))]
  const targetYears = await CycleCharge.find({
    organizationId,
    familyId: targetId,
    cycleYear: { $in: years },
    deletedAt: null,
  })
    .select('cycleYear')
    .lean<Array<{ cycleYear: number }>>()

  const targetYearSet = new Set(targetYears.map((c) => c.cycleYear))
  return years.filter((y) => targetYearSet.has(y)).length
}

export async function getFamilyMergePreview(
  organizationId: string,
  sourceId: string,
  targetId: string,
): Promise<{ ok: true; preview: FamilyMergePreview } | { ok: false; error: string }> {
  const validation = await validateFamilyMerge(organizationId, sourceId, targetId)
  if (!validation.ok) return validation

  type FamilyNameRow = { _id: Types.ObjectId; name?: string }
  const [source, target] = await Promise.all([
    Family.findOne({ _id: sourceId, organizationId }).select('_id name').lean<FamilyNameRow>(),
    Family.findOne({ _id: targetId, organizationId }).select('_id name').lean<FamilyNameRow>(),
  ])

  const base = orgFamilyFilter(organizationId, sourceId)
  const taskFilter = {
    organizationId,
    relatedFamilyId: sourceId,
    deletedAt: null,
  }
  const subFamilyFilter = {
    organizationId,
    parentFamilyId: sourceId,
    deletedAt: null,
  }

  const [
    members,
    payments,
    lifecycleEvents,
    withdrawals,
    cycleCharges,
    statements,
    tasks,
    savedPaymentMethods,
    recurringPayments,
    subFamilies,
    cycleChargeConflicts,
  ] = await Promise.all([
    FamilyMember.countDocuments(base),
    Payment.countDocuments(base),
    LifecycleEventPayment.countDocuments(base),
    Withdrawal.countDocuments(base),
    CycleCharge.countDocuments(base),
    Statement.countDocuments(base),
    Task.countDocuments(taskFilter),
    SavedPaymentMethod.countDocuments({ organizationId, familyId: sourceId, isActive: true }),
    RecurringPayment.countDocuments({ organizationId, familyId: sourceId, isActive: true }),
    Family.countDocuments(subFamilyFilter),
    countCycleChargeConflicts(organizationId, sourceId, targetId),
  ])

  const warnings: string[] = []
  if (cycleChargeConflicts > 0) {
    warnings.push(
      `${cycleChargeConflicts} annual dues record(s) overlap with the target and will be archived instead of moved.`,
    )
  }
  if (subFamilies > 0) {
    warnings.push(`${subFamilies} sub-family household(s) will be re-parented under the target.`)
  }
  warnings.push(
    'Historical email logs and scheduled sends are not rewritten; they will still reference the archived source family.',
  )

  return {
    ok: true,
    preview: {
      sourceFamily: { _id: String(source!._id), name: source!.name || '' },
      targetFamily: { _id: String(target!._id), name: target!.name || '' },
      counts: {
        members,
        payments,
        lifecycleEvents,
        withdrawals,
        cycleCharges,
        cycleChargeConflicts,
        statements,
        tasks,
        savedPaymentMethods,
        recurringPayments,
        subFamilies,
      },
      warnings,
    },
  }
}

export async function mergeFamilies(
  organizationId: string,
  sourceId: string,
  targetId: string,
  ctx: OrgContext,
  opts: { request?: Request } = {},
): Promise<{ ok: true; result: FamilyMergeResult } | { ok: false; error: string }> {
  const previewResult = await getFamilyMergePreview(organizationId, sourceId, targetId)
  if (!previewResult.ok) return previewResult

  const { preview } = previewResult
  const orgOid = new Types.ObjectId(organizationId)
  const sourceOid = new Types.ObjectId(sourceId)
  const targetOid = new Types.ObjectId(targetId)
  const base = { organizationId: orgOid, familyId: sourceOid, deletedAt: null }
  const at = new Date()

  // Resolve cycle-charge conflicts before bulk-moving the rest.
  const sourceCharges = await CycleCharge.find(base).select('_id cycleYear').lean()
  if (sourceCharges.length > 0) {
    const years = [...new Set(sourceCharges.map((c) => c.cycleYear))]
    const targetYears = await CycleCharge.find({
      organizationId: orgOid,
      familyId: targetOid,
      cycleYear: { $in: years },
      deletedAt: null,
    })
      .select('cycleYear')
      .lean<Array<{ cycleYear: number }>>()
    const conflictYears = new Set(targetYears.map((c) => c.cycleYear))
    const conflictIds = sourceCharges
      .filter((c) => conflictYears.has(c.cycleYear))
      .map((c) => c._id)

    if (conflictIds.length > 0) {
      await CycleCharge.updateMany(
        { _id: { $in: conflictIds }, organizationId: orgOid },
        { $set: { deletedAt: at, deletedBy: ctx.userId, deletedKind: 'merge_conflict' } },
      )
    }

    await CycleCharge.updateMany(
      {
        organizationId: orgOid,
        familyId: sourceOid,
        deletedAt: null,
      },
      { $set: { familyId: targetOid } },
    )
  }

  const [
    memberRes,
    paymentRes,
    lifecycleRes,
    withdrawalRes,
    statementRes,
    taskRes,
    savedPmRes,
    recurringRes,
    subFamilyRes,
  ] = await Promise.all([
    FamilyMember.updateMany(base, { $set: { familyId: targetOid } }),
    Payment.updateMany(base, { $set: { familyId: targetOid } }),
    LifecycleEventPayment.updateMany(base, { $set: { familyId: targetOid } }),
    Withdrawal.updateMany(base, { $set: { familyId: targetOid } }),
    Statement.updateMany(base, { $set: { familyId: targetOid } }),
    Task.updateMany(
      { organizationId: orgOid, relatedFamilyId: sourceOid, deletedAt: null },
      { $set: { relatedFamilyId: targetOid } },
    ),
    SavedPaymentMethod.updateMany(
      { organizationId: orgOid, familyId: sourceOid },
      { $set: { familyId: targetOid } },
    ),
    RecurringPayment.updateMany(
      { organizationId: orgOid, familyId: sourceOid },
      { $set: { familyId: targetOid } },
    ),
    Family.updateMany(
      { organizationId: orgOid, parentFamilyId: sourceOid, deletedAt: null },
      { $set: { parentFamilyId: targetOid } },
    ),
  ])

  const moved: FamilyMergeCounts = {
    members: memberRes.modifiedCount,
    payments: paymentRes.modifiedCount,
    lifecycleEvents: lifecycleRes.modifiedCount,
    withdrawals: withdrawalRes.modifiedCount,
    cycleCharges: preview.counts.cycleCharges - preview.counts.cycleChargeConflicts,
    cycleChargeConflicts: preview.counts.cycleChargeConflicts,
    statements: statementRes.modifiedCount,
    tasks: taskRes.modifiedCount,
    savedPaymentMethods: savedPmRes.modifiedCount,
    recurringPayments: recurringRes.modifiedCount,
    subFamilies: subFamilyRes.modifiedCount,
  }

  await Family.updateOne(
    { _id: sourceOid, organizationId: orgOid, deletedAt: null },
    {
      $set: {
        deletedAt: at,
        deletedBy: ctx.userId,
        deletedKind: 'merge',
      },
    },
  )

  const paymentYears = await Payment.find({
    organizationId: orgOid,
    familyId: targetOid,
    deletedAt: null,
  })
    .select('year')
    .lean<Array<{ year?: number }>>()
  const years = new Set<number>()
  for (const p of paymentYears) {
    if (typeof p.year === 'number' && Number.isFinite(p.year)) years.add(p.year)
  }
  for (const year of years) {
    scheduleYearlyCalculationRefresh(year, organizationId)
  }

  await audit({
    organizationId,
    userId: ctx.userId,
    action: 'family.merge',
    resourceType: 'Family',
    resourceId: sourceId,
    metadata: {
      sourceFamilyId: sourceId,
      sourceFamilyName: preview.sourceFamily.name,
      targetFamilyId: targetId,
      targetFamilyName: preview.targetFamily.name,
      moved,
    },
    request: opts.request,
  })

  return { ok: true, result: { ok: true, preview, moved } }
}
