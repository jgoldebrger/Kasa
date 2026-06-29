import { Types } from 'mongoose'
import { Family, LifecycleEventPayment } from '@/lib/models'
import { calculateFamilyBalance } from '@/lib/calculations'

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

export async function resolveAutomationRecipients(
  organizationId: string,
  ruleType: 'balance_gt_zero' | 'event_within_30_days',
): Promise<AutomationRecipientPreview> {
  const candidateIds =
    ruleType === 'balance_gt_zero'
      ? await candidateFamilyIdsForBalanceRule(organizationId)
      : await candidateFamilyIdsForEventRule(organizationId)

  if (candidateIds.length === 0) {
    return { recipientCount: 0, sampleFamilies: [], skipped: { noEmail: 0, optOut: 0 } }
  }

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

export async function listAutomationRecipients(
  organizationId: string,
  ruleType: 'balance_gt_zero' | 'event_within_30_days',
): Promise<AutomationRecipient[]> {
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
