import { Types } from 'mongoose'
import { Family, LifecycleEventPayment, Organization } from '@/lib/models'
import { calculateFamilyBalance } from '@/lib/calculations'
import { familyBatches } from '@/lib/org-pagination'
import { canReceiveDunningEmail, qualifiesForDunning } from '@/lib/dunning/qualify'
import { obligationStartDate } from '@/lib/dunning/obligation'
import type { EmailAutomationRuleType } from '@/lib/dunning/types'

export type AutomationRuleRef =
  | EmailAutomationRuleType
  | {
      ruleType: EmailAutomationRuleType
      minOwed?: number
      daysSinceObligation?: number
      maxAttempts?: number
      intervalDays?: number
      _id?: { toString(): string }
    }

function ruleTypeOf(rule: AutomationRuleRef): EmailAutomationRuleType {
  return typeof rule === 'string' ? rule : rule.ruleType
}

async function candidateFamilyIdsForBalanceRule(organizationId: string): Promise<string[]> {
  const families = await Family.find({ organizationId })
    .select('_id')
    .lean<{ _id: Types.ObjectId }[]>()

  const matching: string[] = []
  for (const fam of families) {
    const familyId = String(fam._id)
    try {
      const bal = await calculateFamilyBalance(familyId, organizationId)
      if (bal.balance > 0) matching.push(familyId)
    } catch {
      /* skip */
    }
  }
  return matching
}

async function candidateFamilyIdsForEventRule(organizationId: string): Promise<string[]> {
  const now = new Date()
  const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
  const rows = await LifecycleEventPayment.find({
    organizationId,
    eventDate: { $gte: now, $lte: horizon },
    deletedAt: null,
  })
    .select('familyId')
    .lean<{ familyId?: Types.ObjectId }[]>()

  return [...new Set(rows.map((r) => String(r.familyId)).filter(Boolean))]
}

export type AutomationRecipient = { id: string; name: string; email: string }

export type AutomationRecipientPreview = {
  recipientCount: number
  sampleFamilies: AutomationRecipient[]
  skipped: { noEmail: number; optOut: number }
}

const emptyPreview = (): AutomationRecipientPreview => ({
  recipientCount: 0,
  sampleFamilies: [],
  skipped: { noEmail: 0, optOut: 0 },
})

async function previewFromCandidateIds(
  organizationId: string,
  candidateIds: string[],
): Promise<AutomationRecipientPreview> {
  if (candidateIds.length === 0) return emptyPreview()

  const families = await Family.find({
    organizationId,
    _id: { $in: candidateIds },
  }).lean<any[]>()

  let noEmail = 0
  let optOut = 0
  const recipients: AutomationRecipient[] = []

  for (const family of families) {
    if (family.communicationsOptOut) {
      optOut++
      continue
    }
    if (!family.email || family.emailFormatInvalid) {
      noEmail++
      continue
    }
    recipients.push({
      id: String(family._id),
      name: family.name || '',
      email: family.email,
    })
  }

  return {
    recipientCount: recipients.length,
    sampleFamilies: recipients.slice(0, 10),
    skipped: { noEmail, optOut },
  }
}

type DunningFamilyDoc = {
  _id: Types.ObjectId
  name?: string
  email?: string | null
  emailFormatInvalid?: boolean
  communicationsOptOut?: boolean
  createdAt: Date
}

async function previewDunningArrears(
  organizationId: string,
  rule: AutomationRuleRef,
): Promise<AutomationRecipientPreview> {
  const minOwed = typeof rule === 'object' ? rule.minOwed : undefined
  if (minOwed == null || minOwed <= 0) return emptyPreview()

  const daysSinceObligation = typeof rule === 'object' ? (rule.daysSinceObligation ?? 30) : 30

  const org = await Organization.findById(organizationId)
    .select('timezone')
    .lean<{ timezone?: string } | null>()
  const timezone = org?.timezone
  const now = new Date()

  let noEmail = 0
  let optOut = 0
  const recipients: AutomationRecipient[] = []

  for await (const batch of familyBatches(organizationId, {
    select: '_id name email emailFormatInvalid communicationsOptOut createdAt',
  })) {
    for (const raw of batch) {
      const family = raw as DunningFamilyDoc
      const familyId = String(family._id)

      const { balance } = await calculateFamilyBalance(familyId, organizationId)
      const obligationStart = await obligationStartDate({
        organizationId,
        familyId,
        familyCreatedAt: family.createdAt,
      })
      const qualifies = qualifiesForDunning({
        balance,
        minOwed,
        obligationStart,
        now,
        timezone,
        daysSinceObligation,
      })
      if (!qualifies) continue

      if (family.communicationsOptOut) {
        optOut++
        continue
      }
      if (!canReceiveDunningEmail(family)) {
        noEmail++
        continue
      }

      recipients.push({
        id: familyId,
        name: family.name || '',
        email: family.email || '',
      })
    }
  }

  return {
    recipientCount: recipients.length,
    sampleFamilies: recipients.slice(0, 10),
    skipped: { noEmail, optOut },
  }
}

export async function resolveAutomationRecipients(
  organizationId: string,
  rule: AutomationRuleRef,
): Promise<AutomationRecipientPreview> {
  const ruleType = ruleTypeOf(rule)
  if (ruleType === 'dunning_arrears') {
    return previewDunningArrears(organizationId, rule)
  }

  const candidateIds =
    ruleType === 'balance_gt_zero'
      ? await candidateFamilyIdsForBalanceRule(organizationId)
      : await candidateFamilyIdsForEventRule(organizationId)

  return previewFromCandidateIds(organizationId, candidateIds)
}

export async function listAutomationRecipients(
  organizationId: string,
  rule: AutomationRuleRef,
): Promise<AutomationRecipient[]> {
  const ruleType = ruleTypeOf(rule)
  if (ruleType === 'dunning_arrears') return []

  const candidateIds =
    ruleType === 'balance_gt_zero'
      ? await candidateFamilyIdsForBalanceRule(organizationId)
      : await candidateFamilyIdsForEventRule(organizationId)

  if (candidateIds.length === 0) return []

  const families = await Family.find({
    organizationId,
    _id: { $in: candidateIds },
    email: { $exists: true, $ne: '' },
    communicationsOptOut: { $ne: true },
    emailFormatInvalid: { $ne: true },
  }).lean<any[]>()

  return families.map((family) => ({
    id: String(family._id),
    name: family.name || '',
    email: family.email,
  }))
}
