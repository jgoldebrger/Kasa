import { z } from 'zod'
import { isoDate, nonEmptyString, objectId, optionalString, trimmedName } from './common'

const phone = optionalString(40)

/** Single family tag — trimmed, 1–50 chars, no control characters. */
export const familyTag = z
  .string()
  .trim()
  .min(1, 'Tag cannot be empty')
  .max(50, 'Tag must be 50 characters or fewer')
  .refine((s) => !/[\x00-\x1f]/.test(s), { message: 'Tag contains invalid characters' })

/** Up to 20 unique tags per family. */
export const familyTags = z.array(familyTag).max(20, 'At most 20 tags per family')

/** Normalize tags: trim, dedupe case-insensitively, cap at 20. */
export function normalizeFamilyTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags) {
    const t = raw.trim()
    if (!t) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
    if (out.length >= 20) break
  }
  return out
}

const bulkIdsField = z.array(objectId).min(1, 'Select at least one family').max(500)

export const familyBody = z.object({
  name: trimmedName,
  hebrewName: optionalString(200),
  weddingDate: isoDate,
  husbandFirstName: optionalString(120),
  husbandHebrewName: optionalString(120),
  husbandFatherHebrewName: optionalString(120),
  wifeFirstName: optionalString(120),
  wifeHebrewName: optionalString(120),
  wifeFatherHebrewName: optionalString(120),
  husbandCellPhone: phone,
  wifeCellPhone: phone,
  phone,
  email: optionalString(254),
  address: optionalString(300),
  street: optionalString(200),
  city: optionalString(120),
  state: optionalString(60),
  zip: optionalString(20),
  currentPlan: z.number().int().nonnegative().optional(),
  paymentPlanId: objectId.optional().nullable(),
  currentPayment: z.number().finite().nonnegative().optional(),
  openBalance: z.number().finite().optional(),
  parentFamilyId: objectId.optional().nullable(),
  emailOptOut: z.boolean().optional(),
  communicationsOptOut: z.boolean().optional(),
  tags: familyTags.optional(),
})

export const familyUpdateBody = familyBody.partial()

/** POST /api/families — paymentPlanId required at create time. */
export const familyCreateBody = familyBody.extend({
  paymentPlanId: objectId,
})

export const familyMemberBody = z.object({
  familyId: objectId,
  firstName: nonEmptyString(120),
  hebrewFirstName: optionalString(120),
  lastName: nonEmptyString(120),
  hebrewLastName: optionalString(120),
  birthDate: isoDate.optional().nullable(),
  hebrewBirthDate: optionalString(80),
  gender: optionalString(20),
  barMitzvahDate: isoDate.optional().nullable(),
  batMitzvahDate: isoDate.optional().nullable(),
  weddingDate: isoDate.optional().nullable(),
  spouseName: optionalString(200),
  spouseFirstName: optionalString(120),
  spouseHebrewName: optionalString(120),
  spouseFatherHebrewName: optionalString(120),
  spouseCellPhone: phone,
  phone,
  email: optionalString(254),
  address: optionalString(300),
  city: optionalString(120),
  state: optionalString(60),
  zip: optionalString(20),
  paymentPlan: z.number().int().nonnegative().optional(),
  paymentPlanId: objectId.optional().nullable(),
  notes: optionalString(2000),
})

export const familyMemberUpdateBody = familyMemberBody.partial()

/** PATCH /api/families/[id] — email flags and/or tags. */
export const familyPatchBody = z
  .object({
    emailDeliverabilityWarning: z.literal(false).optional(),
    emailFormatInvalid: z.literal(false).optional(),
    tags: familyTags.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' })

/** POST /api/families/bulk */
export const familiesBulkBody = z.union([
  z.object({ action: z.literal('delete'), ids: bulkIdsField }),
  z.object({
    action: z.literal('setPaymentPlan'),
    ids: bulkIdsField,
    paymentPlanId: objectId.nullable(),
  }),
  z.object({
    action: z.literal('setEmailOptOut'),
    ids: bulkIdsField,
    emailOptOut: z.boolean(),
  }),
  z.object({
    action: z.literal('setCommunicationsOptOut'),
    ids: bulkIdsField,
    communicationsOptOut: z.boolean(),
  }),
  z.object({
    action: z.literal('setTags'),
    ids: bulkIdsField,
    mode: z.enum(['add', 'remove', 'replace']),
    tags: z.array(familyTag).min(1, 'Provide at least one tag').max(20),
  }),
])

/** POST /api/families/[id]/members — birthDate required at create time. */
export const familyMemberCreateBody = familyMemberBody
  .omit({ familyId: true })
  .extend({ birthDate: isoDate })
