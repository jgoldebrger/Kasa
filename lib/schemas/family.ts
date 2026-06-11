import { z } from 'zod'
import { isoDate, nonEmptyString, objectId, optionalString, trimmedName } from './common'

const phone = optionalString(40)

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

/** POST /api/families/[id]/members — birthDate required at create time. */
export const familyMemberCreateBody = familyMemberBody
  .omit({ familyId: true })
  .extend({ birthDate: isoDate })
