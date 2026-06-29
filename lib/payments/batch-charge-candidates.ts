/**
 * Families eligible for admin batch saved-card charges:
 * - due recurring payments (nextPaymentDate <= today)
 * - negative ledger balance with a chargeable saved card
 */

import { Types } from 'mongoose'
import {
  Family,
  Organization,
  PaymentPlan,
  RecurringPayment,
  SavedPaymentMethod,
  Payment,
  Withdrawal,
  CycleCharge,
} from '@/lib/models'
import { loadAllByIdCursor } from '@/lib/org-pagination'
import { startOfDayInTimeZone } from '@/lib/date-utils'
import {
  isLegacyPlatformPaymentMethod,
  isStripeConnectEnabled,
  getOrgStripeConnect,
  ORG_CONNECT_WITH_TIMEZONE_SELECT,
  type OrgStripeConnectFields,
} from '@/lib/stripe/client'
import { enforceMemberChargeGate } from '@/lib/billing/feature-gate'

export type BatchChargeReason = 'recurring_due' | 'negative_balance'

export interface BatchChargeCandidate {
  familyId: string
  familyName: string
  amount: number
  reason: BatchChargeReason
  savedPaymentMethodId: string
  cardLast4: string
  cardType: string
  recurringPaymentId?: string
  balance?: number
}

export interface BatchChargePreview {
  candidates: BatchChargeCandidate[]
  totalAmount: number
  billingBlocked?: string
}

async function resolveChargeableCard(
  organizationId: string,
  familyId: Types.ObjectId,
  preferredId?: Types.ObjectId,
): Promise<{ _id: Types.ObjectId; [key: string]: unknown } | null> {
  if (preferredId) {
    const spm = await SavedPaymentMethod.findOne({
      _id: preferredId,
      organizationId,
      familyId,
      isActive: true,
    })
    if (spm && !isLegacyPlatformPaymentMethod(spm)) return spm
  }

  const defaultCard = await SavedPaymentMethod.findOne({
    organizationId,
    familyId,
    isActive: true,
    isDefault: true,
  })
  if (defaultCard && !isLegacyPlatformPaymentMethod(defaultCard)) return defaultCard

  const anyCard = await SavedPaymentMethod.findOne({
    organizationId,
    familyId,
    isActive: true,
    legacyPlatformAccount: { $ne: true },
  }).sort({ isDefault: -1, createdAt: -1 })

  return anyCard
}

async function familyBalances(
  organizationId: Types.ObjectId,
  familyIds: Types.ObjectId[],
): Promise<Map<string, number>> {
  const familyMatch = familyIds.length > 0 ? { familyId: { $in: familyIds } } : {}

  const families = await Family.find({ organizationId, deletedAt: null })
    .select('_id paymentPlanId')
    .lean<Array<{ _id: Types.ObjectId; paymentPlanId?: Types.ObjectId }>>()

  const plans = await loadAllByIdCursor<any>(
    (filter, limit) =>
      PaymentPlan.find(filter).select('_id yearlyPrice').sort({ _id: 1 }).limit(limit).lean(),
    { organizationId },
  )
  const planPriceById = new Map<string, number>()
  for (const p of plans) planPriceById.set(String(p._id), Number(p.yearlyPrice || 0))

  const [paySums, withSums, cycleSums] = await Promise.all([
    Payment.aggregate([
      { $match: { organizationId, deletedAt: null, ...familyMatch } },
      {
        $group: {
          _id: '$familyId',
          total: {
            $sum: {
              $max: [
                0,
                {
                  $subtract: [{ $ifNull: ['$amount', 0] }, { $ifNull: ['$refundedAmount', 0] }],
                },
              ],
            },
          },
        },
      },
    ]),
    Withdrawal.aggregate([
      { $match: { organizationId, deletedAt: null, ...familyMatch } },
      { $group: { _id: '$familyId', total: { $sum: '$amount' } } },
    ]),
    CycleCharge.aggregate([
      { $match: { organizationId, deletedAt: null, ...familyMatch } },
      { $group: { _id: '$familyId', total: { $sum: '$amount' } } },
    ]),
  ])

  const sumMap = (rows: Array<{ _id: Types.ObjectId; total: number }>) => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(String(r._id), Number(r.total || 0))
    return m
  }

  const payByFamily = sumMap(paySums)
  const withByFamily = sumMap(withSums)
  const cycleByFamily = sumMap(cycleSums)

  const balances = new Map<string, number>()
  for (const f of families) {
    const id = String(f._id)
    const planCost = f.paymentPlanId ? planPriceById.get(String(f.paymentPlanId)) || 0 : 0
    const balance =
      (payByFamily.get(id) || 0) -
      (withByFamily.get(id) || 0) -
      (cycleByFamily.get(id) || 0) -
      planCost
    balances.set(id, balance)
  }
  return balances
}

export async function buildBatchChargePreview(organizationId: string): Promise<BatchChargePreview> {
  const billingGate = await enforceMemberChargeGate(organizationId)
  if (!billingGate.ok) {
    return { candidates: [], totalAmount: 0, billingBlocked: billingGate.error }
  }

  const orgId = new Types.ObjectId(organizationId)
  const org = await Organization.findById(organizationId)
    .select(ORG_CONNECT_WITH_TIMEZONE_SELECT)
    .lean<OrgStripeConnectFields & { timezone?: string }>()
  const connect = getOrgStripeConnect(org)
  const today = startOfDayInTimeZone(org?.timezone)

  const candidates: BatchChargeCandidate[] = []
  const seenKeys = new Set<string>()

  const dueRecurring = await RecurringPayment.find({
    organizationId,
    isActive: true,
    nextPaymentDate: { $lte: today },
  })
    .populate({
      path: 'familyId',
      select: 'name organizationId deletedAt',
      match: { organizationId },
      options: { includeDeleted: true },
    })
    .lean()

  for (const rp of dueRecurring) {
    const family = rp.familyId as { _id?: Types.ObjectId; name?: string; deletedAt?: Date } | null
    if (!family?._id || family.deletedAt) continue

    if (isStripeConnectEnabled() && !connect) continue

    const card = await resolveChargeableCard(
      organizationId,
      family._id,
      rp.savedPaymentMethodId as Types.ObjectId,
    )
    if (!card || rp.amount <= 0) continue

    const key = `${family._id}:recurring_due:${rp._id}`
    if (seenKeys.has(key)) continue
    seenKeys.add(key)

    candidates.push({
      familyId: String(family._id),
      familyName: family.name || 'Unknown',
      amount: rp.amount,
      reason: 'recurring_due',
      savedPaymentMethodId: String(card._id),
      cardLast4: String(card.last4 ?? ''),
      cardType: String(card.cardType ?? ''),
      recurringPaymentId: String(rp._id),
    })
  }

  const balances = await familyBalances(orgId, [])
  const negativeFamilies = [...balances.entries()].filter(([, bal]) => bal < -0.005)

  for (const [familyId, balance] of negativeFamilies) {
    const family = await Family.findOne({ _id: familyId, organizationId }).select('name').lean<{
      name?: string
    }>()
    if (!family) continue

    if (isStripeConnectEnabled() && !connect) continue

    const card = await resolveChargeableCard(organizationId, new Types.ObjectId(familyId))
    if (!card) continue

    const amount = Math.round(Math.abs(balance) * 100) / 100
    if (amount <= 0) continue

    const key = `${familyId}:negative_balance`
    if (seenKeys.has(key)) continue
    seenKeys.add(key)

    candidates.push({
      familyId,
      familyName: family.name || 'Unknown',
      amount,
      reason: 'negative_balance',
      savedPaymentMethodId: String(card._id),
      cardLast4: String(card.last4 ?? ''),
      cardType: String(card.cardType ?? ''),
      balance,
    })
  }

  candidates.sort((a, b) => a.familyName.localeCompare(b.familyName))

  const totalAmount = candidates.reduce((sum, c) => sum + c.amount, 0)
  return { candidates, totalAmount }
}
