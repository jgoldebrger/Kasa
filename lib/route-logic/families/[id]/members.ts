import {
  Family,
  FamilyMember,
  LifecycleEventPayment,
  Organization,
  PaymentPlan,
  LifecycleEvent,
} from '@/lib/models'
import { calculateBarMitzvahDate, hasReachedBarMitzvahAge } from '@/lib/hebrew-date'
import { getYearInTimeZone } from '@/lib/date-utils'
import { scheduleYearlyCalculationRefresh } from '@/lib/calculations'
import { audit } from '@/lib/audit'
import { hasMinRole } from '@/lib/auth-helpers'
import { family as familySchemas } from '@/lib/schemas'
import { checkRateLimit } from '@/lib/rate-limit'
import { loadAllByIdCursor } from '@/lib/org-pagination'
import { handler } from '@/lib/api/handler'

export const GET = handler({
  auth: 'org',
  idParams: ['id'],
  name: 'GET /api/families/[id]/members',
  fn: async ({ params, ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'family-members-list',
      { limit: 120, windowMs: 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const id = params.id as string
    const fam = await Family.findOne({ _id: id, organizationId: ctx!.organizationId }).select('_id')
    if (!fam) {
      return { status: 404, data: { error: 'Family not found' } }
    }
    const isAdmin = hasMinRole(ctx!.role, 'admin')
    const members = await loadAllByIdCursor<any>(
      (filter, limit) =>
        FamilyMember.find(filter).sort({ birthDate: 1, _id: 1 }).limit(limit).lean(),
      {
        familyId: id,
        organizationId: ctx!.organizationId,
        convertedToFamily: { $ne: true },
      },
    )

    const out = isAdmin
      ? members
      : members.map((m) => {
          const row = typeof m.toObject === 'function' ? m.toObject() : { ...m }
          delete (row as any).paymentPlanId
          delete (row as any).paymentPlan
          delete (row as any).paymentPlanAssigned
          return row
        })
    return { data: out }
  },
})

export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id'],
  body: familySchemas.familyMemberCreateBody,
  name: 'POST /api/families/[id]/members',
  fn: async ({ params, ctx, body, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'family-member-create',
      { limit: 30, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const id = params.id as string
    const {
      firstName,
      hebrewFirstName,
      lastName,
      hebrewLastName,
      birthDate: birthDateObj,
      hebrewBirthDate,
      gender,
      weddingDate,
      spouseName,
      spouseFirstName,
      spouseHebrewName,
      spouseFatherHebrewName,
      spouseCellPhone,
      phone,
      email,
      address,
      city,
      state,
      zip,
    } = body

    const fam = await Family.findOne({ _id: id, organizationId: ctx!.organizationId }).select('_id')
    if (!fam) {
      return { status: 404, data: { error: 'Family not found' } }
    }

    let finalHebrewBirthDate = hebrewBirthDate
    if (!finalHebrewBirthDate && birthDateObj) {
      const { convertToHebrewDate } = await import('@/lib/hebrew-date')
      finalHebrewBirthDate = convertToHebrewDate(birthDateObj)
    }

    let barMitzvahDate: Date | null = null
    if (finalHebrewBirthDate && finalHebrewBirthDate.trim()) {
      barMitzvahDate = calculateBarMitzvahDate(finalHebrewBirthDate)
    }

    const member = await FamilyMember.create({
      familyId: id,
      firstName,
      hebrewFirstName: hebrewFirstName || undefined,
      lastName,
      hebrewLastName: hebrewLastName || undefined,
      birthDate: birthDateObj,
      hebrewBirthDate: finalHebrewBirthDate || undefined,
      gender: gender || undefined,
      weddingDate: weddingDate ?? undefined,
      spouseName: spouseName || undefined,
      spouseFirstName: spouseFirstName || undefined,
      spouseHebrewName: spouseHebrewName || undefined,
      spouseFatherHebrewName: spouseFatherHebrewName || undefined,
      spouseCellPhone: spouseCellPhone || undefined,
      phone: phone || undefined,
      email: email || undefined,
      address: address || undefined,
      city: city || undefined,
      state: state || undefined,
      zip: zip || undefined,
      barMitzvahDate: barMitzvahDate || undefined,
      barMitzvahEventAdded: false,
      paymentPlan: null,
      paymentPlanAssigned: false,
      organizationId: ctx!.organizationId,
    })

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'familyMember.create',
      resourceType: 'FamilyMember',
      resourceId: member._id,
      metadata: {
        familyId: id,
        firstName,
        lastName,
        gender: gender || undefined,
      },
      request,
    })

    const org = await Organization.findById(ctx!.organizationId)
      .select(
        'barMitzvahAutoAssignPlanId barMitzvahAutoCreateEventTypeId addChildAutoCreateEventTypeId timezone',
      )
      .lean<any>()

    if (org?.addChildAutoCreateEventTypeId) {
      try {
        const evType = await LifecycleEvent.findOne({
          _id: org.addChildAutoCreateEventTypeId,
          organizationId: ctx!.organizationId,
        })
          .select('type amount name')
          .lean<any>()
        if (evType) {
          const eventDate = birthDateObj ?? new Date()
          const eventYear = getYearInTimeZone(org?.timezone, eventDate)
          await LifecycleEventPayment.create({
            familyId: id,
            eventType: evType.type,
            amount: evType.amount,
            eventDate,
            year: eventYear,
            notes: `Auto-added: ${evType.name} for ${firstName} ${lastName} (child added)`,
            organizationId: ctx!.organizationId,
          })
          scheduleYearlyCalculationRefresh(eventYear, ctx!.organizationId)
          console.log(
            `Added "${evType.name}" event for new child ${firstName} ${lastName} (year ${eventYear})`,
          )
        }
      } catch (eventError) {
        console.error('Error auto-adding child lifecycle event:', eventError)
      }
    }

    const reachedBarMitzvahNow =
      gender === 'male' &&
      finalHebrewBirthDate &&
      finalHebrewBirthDate.trim() &&
      hasReachedBarMitzvahAge(finalHebrewBirthDate)

    if (reachedBarMitzvahNow || (barMitzvahDate && !member.barMitzvahEventAdded)) {
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
        } catch (planError) {
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
            scheduleYearlyCalculationRefresh(eventYear, ctx!.organizationId)
            member.barMitzvahEventAdded = true
            await member.save()
            console.log(
              `Added "${evType.name}" event for ${firstName} ${lastName} (year ${eventYear})`,
            )
          }
        } catch (eventError) {
          console.error('Error auto-adding Bar Mitzvah event:', eventError)
        }
      }
    }

    return { status: 201, data: member }
  },
})
