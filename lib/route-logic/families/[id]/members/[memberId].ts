import { handler } from '@/lib/api/handler'
import {
  FamilyMember,
  LifecycleEventPayment,
  Organization,
  PaymentPlan,
  LifecycleEvent,
} from '@/lib/models'
import { convertToHebrewDate, calculateBarMitzvahDate, hasReachedBarMitzvahAge } from '@/lib/hebrew-date'
import { getYearInTimeZone } from '@/lib/date-utils'
import { softDeleteOne } from '@/lib/recycle-bin'
import { family as familySchemas } from '@/lib/schemas'
import { checkRateLimit } from '@/lib/rate-limit'
import mongoose from 'mongoose'

// PUT - Update a member.
//
// admin+ to match the rest of the member CRUD (CREATE + DELETE both
// enforce admin). Updates here can also trigger Bar Mitzvah lifecycle
// hooks that mutate the ledger, so this is not a "members can edit
// their own data" surface — it's an admin tool.
export const PUT = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id', 'memberId'],
  body: familySchemas.familyMemberCreateBody,
  name: 'PUT /api/families/[id]/members/[memberId]',
  fn: async ({ params, ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'family-member-update',
      { limit: 60, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    if (mongoose.connection.readyState !== 1) {
      throw new Error('Database connection not ready')
    }

    const id = params.id as string
    const memberId = params.memberId as string
    const {
      firstName, hebrewFirstName, lastName, hebrewLastName, birthDate: birthDateObj, hebrewBirthDate, gender,
      weddingDate, spouseName, spouseFirstName, spouseHebrewName, spouseFatherHebrewName,
      spouseCellPhone, phone, email, address, city, state, zip
    } = body

    // Auto-calculate Hebrew date if not provided
    let finalHebrewBirthDate = hebrewBirthDate
    if (!finalHebrewBirthDate || !finalHebrewBirthDate.trim()) {
      try {
        finalHebrewBirthDate = convertToHebrewDate(birthDateObj)
      } catch (dateError) {
        console.error('Error converting to Hebrew date:', dateError)
        // Continue without Hebrew date if conversion fails
      }
    }

    // Calculate bar mitzvah date if Hebrew date is provided
    let barMitzvahDate: Date | null = null
    if (finalHebrewBirthDate && finalHebrewBirthDate.trim()) {
      try {
        barMitzvahDate = calculateBarMitzvahDate(finalHebrewBirthDate)
      } catch (dateError) {
        console.error('Error calculating bar mitzvah date:', dateError)
        // Continue without bar mitzvah date if calculation fails
      }
    }

    const updateData: any = {
      firstName,
      lastName,
      birthDate: birthDateObj,
    }

    if (finalHebrewBirthDate && finalHebrewBirthDate.trim()) {
      updateData.hebrewBirthDate = finalHebrewBirthDate.trim()
    }
    if (gender && (gender === 'male' || gender === 'female')) {
      updateData.gender = gender
    }
    if (barMitzvahDate) {
      updateData.barMitzvahDate = barMitzvahDate
    }

    // Handle wedding date - if provided, will trigger auto-conversion
    if (weddingDate) {
      updateData.weddingDate = weddingDate
    }
    if (spouseName) {
      updateData.spouseName = spouseName.trim()
    }
    // Handle spouse information fields
    if (hebrewFirstName !== undefined) {
      updateData.hebrewFirstName = hebrewFirstName || null
    }
    if (hebrewLastName !== undefined) {
      updateData.hebrewLastName = hebrewLastName || null
    }
    if (spouseFirstName !== undefined) {
      updateData.spouseFirstName = spouseFirstName || null
    }
    if (spouseHebrewName !== undefined) {
      updateData.spouseHebrewName = spouseHebrewName || null
    }
    if (spouseFatherHebrewName !== undefined) {
      updateData.spouseFatherHebrewName = spouseFatherHebrewName || null
    }
    if (spouseCellPhone !== undefined) {
      updateData.spouseCellPhone = spouseCellPhone || null
    }
    if (phone !== undefined) {
      updateData.phone = phone || null
    }
    if (email !== undefined) {
      updateData.email = email || null
    }
    // Handle address fields - always update if present in body (even if empty)
    if (address !== undefined) {
      updateData.address = address || null
    }
    if (city !== undefined) {
      updateData.city = city || null
    }
    if (state !== undefined) {
      updateData.state = state || null
    }
    if (zip !== undefined) {
      updateData.zip = zip || null
    }
    
    // Mongoose automatically converts string IDs to ObjectIds, so we don't need explicit conversion
    const member = await FamilyMember.findOneAndUpdate(
      { _id: memberId, familyId: id, organizationId: ctx!.organizationId },
      { $set: updateData },
      { new: true, runValidators: true }
    )

    if (!member) {
      return { status: 404, data: { error: 'Member not found' } }
    }

    // Bar Mitzvah automation hooks. Both pieces are gated on org-level
    // config in Organization.barMitzvahAutoAssignPlanId /
    // barMitzvahAutoCreateEventTypeId. Each independently no-ops when its
    // pointer is null.
    const reachedBarMitzvahNow =
      gender === 'male' &&
      finalHebrewBirthDate &&
      finalHebrewBirthDate.trim() &&
      hasReachedBarMitzvahAge(finalHebrewBirthDate) &&
      !member.paymentPlanAssigned

    if (reachedBarMitzvahNow || (barMitzvahDate && !member.barMitzvahEventAdded)) {
      const org = await Organization.findById(ctx!.organizationId)
        .select('barMitzvahAutoAssignPlanId barMitzvahAutoCreateEventTypeId timezone')
        .lean<any>()

      if (reachedBarMitzvahNow && org?.barMitzvahAutoAssignPlanId) {
        try {
          const plan = await PaymentPlan.findOne({
            _id: org.barMitzvahAutoAssignPlanId,
            organizationId: ctx!.organizationId,
          })
            .select('planNumber name')
            .lean<any>()
          if (plan) {
            member.paymentPlanId = plan._id
            member.paymentPlan = plan.planNumber ?? null
            member.paymentPlanAssigned = true
            await member.save()
            console.log(
              `Auto-assigned "${plan.name}" to ${firstName} ${lastName} (Bar Mitzvah trigger)`,
            )
          }
        } catch (planError: any) {
          console.error('Error auto-assigning Bar Mitzvah payment plan:', planError)
        }
      }

      if (barMitzvahDate && !member.barMitzvahEventAdded && org?.barMitzvahAutoCreateEventTypeId) {
        try {
          const evType = await LifecycleEvent.findOne({
            _id: org.barMitzvahAutoCreateEventTypeId,
            organizationId: ctx!.organizationId,
          })
            .select('type amount name')
            .lean<any>()
          if (evType) {
            const eventYear = getYearInTimeZone(org?.timezone, barMitzvahDate)
            await LifecycleEventPayment.create({
              familyId: id,
              eventType: evType.type,
              amount: evType.amount,
              eventDate: barMitzvahDate,
              year: eventYear,
              notes: `Auto-added: ${evType.name} for ${firstName} ${lastName} (date: ${barMitzvahDate.toLocaleDateString()})`,
              organizationId: ctx!.organizationId,
            })
            member.barMitzvahEventAdded = true
            await member.save()
            console.log(
              `Added "${evType.name}" event for ${firstName} ${lastName} (year ${eventYear})`,
            )
          }
        } catch (eventError: any) {
          console.error('Error auto-adding Bar Mitzvah event:', eventError)
        }
      }
    }

    // Note: Conversion happens on the wedding date via scheduled job, not immediately

    return { data: member }
  },
})

// DELETE - Move a member to the recycle bin (restorable for 30 days).
export const DELETE = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id', 'memberId'],
  name: 'DELETE /api/families/[id]/members/[memberId]',
  fn: async ({ params, ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'family-member-delete',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const id = params.id as string
    const memberId = params.memberId as string

    const member = await FamilyMember.findOne({
      _id: memberId,
      familyId: id,
      organizationId: ctx!.organizationId,
    })
    if (!member) {
      return { status: 404, data: { error: 'Member not found' } }
    }

    await softDeleteOne('familyMember', memberId, ctx!, {
      metadata: { familyId: id },
      request,
    })

    return { data: { message: 'Member moved to recycle bin' } }
  },
})

