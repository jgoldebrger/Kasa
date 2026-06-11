import { Family, FamilyMember, Organization, PaymentPlan } from '@/lib/models'
import { audit } from '@/lib/audit'
import { checkRateLimit } from '@/lib/rate-limit'
import { enforceFamilyCapGate } from '@/lib/billing/feature-gate'
import { handler } from '@/lib/api/handler'

// POST - Convert a child/member to their own family.
//
// admin+: this CREATES a new top-level Family (which immediately enters
// the billing system) and DELETES the source FamilyMember. Both ends
// are admin-only operations on their own, so the combined conversion
// must be too.
export const POST = handler({
  auth: 'org',
  minRole: 'admin',
  idParams: ['id', 'memberId'],
  name: 'POST /api/families/[id]/members/[memberId]/convert-to-family',
  fn: async ({ params, ctx, request }) => {
    const rateVerdict = await checkRateLimit(
      request,
      'member-convert-to-family',
      { limit: 10, windowMs: 60 * 60_000 },
      ctx!.organizationId,
    )
    if (!rateVerdict.allowed) {
      return { status: 429, data: { error: 'Too many requests' } }
    }

    const familyGate = await enforceFamilyCapGate(ctx!.organizationId)
    if (!familyGate.ok) {
      return { status: familyGate.status, data: { error: familyGate.error } }
    }

    const id = params.id as string
    const memberId = params.memberId as string
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { status: 400, data: { error: 'Request body required' } }
    }
    const { weddingDate, spouseName } = body

    if (!weddingDate) {
      return { status: 400, data: { error: 'Wedding date is required' } }
    }

    const member = await FamilyMember.findOne({
      _id: memberId,
      familyId: id,
      organizationId: ctx!.organizationId,
    })
    if (!member) {
      return { status: 404, data: { error: 'Member not found' } }
    }
    if (member.convertedToFamily) {
      return { status: 409, data: { error: 'Member has already been converted to a family' } }
    }

    const originalFamily = await Family.findOne({ _id: id, organizationId: ctx!.organizationId })
    if (!originalFamily) {
      return { status: 404, data: { error: 'Family not found' } }
    }

    // Create new family name
    const newFamilyName = spouseName 
      ? `${member.firstName} ${member.lastName} & ${spouseName}`
      : `${member.firstName} ${member.lastName} Family`

    const weddingDateObj = new Date(weddingDate)
    if (Number.isNaN(weddingDateObj.getTime())) {
      return { status: 400, data: { error: 'Invalid wedding date format' } }
    }

    // Plan assignment is driven entirely by org config — no hardcoded
    // years-married brackets. The admin picks a single default plan in
    // Settings → Automation; if it's unset, the new family is created
    // without a plan and the admin assigns one manually.
    const org = await Organization.findById(ctx!.organizationId)
      .select('weddingConversionDefaultPlanId')
      .lean<any>()
    let paymentPlanId: any = null
    let paymentPlanNumber: number | null = null
    if (org?.weddingConversionDefaultPlanId) {
      try {
        const plan = await PaymentPlan.findOne({
          _id: org.weddingConversionDefaultPlanId,
          organizationId: ctx!.organizationId,
        })
          .select('_id planNumber')
          .lean<any>()
        if (plan) {
          paymentPlanId = plan._id
          paymentPlanNumber = plan.planNumber ?? null
        }
      } catch (error) {
        console.error('Error resolving wedding-conversion default plan:', error)
      }
    }

    // Determine spouse information - use new fields if available, otherwise fall back to spouseName
    const spouseFirstName = member.spouseFirstName || (spouseName ? spouseName.trim().split(' ')[0] : '')
    const spouseLastName = spouseName && !member.spouseFirstName 
      ? (spouseName.trim().split(' ').length > 1 ? spouseName.trim().split(' ').slice(1).join(' ') : member.lastName)
      : member.lastName

    // Determine father's Hebrew name based on member gender
    // If male: use current family's husbandHebrewName
    // If female: use current family's wifeHebrewName
    const fatherHebrewName = member.gender === 'male' 
      ? originalFamily.husbandHebrewName || null
      : originalFamily.wifeHebrewName || null

    // Create new family - use address if provided, otherwise use original family address
    const newFamily = await Family.create({
      name: newFamilyName,
      weddingDate: weddingDateObj,
      // Use address if provided, otherwise use original family address
      address: member.address || originalFamily.address,
      street: member.address || originalFamily.street || originalFamily.address,
      phone: member.phone || originalFamily.phone,
      email: member.email || originalFamily.email,
      city: member.city || originalFamily.city,
      state: member.state || originalFamily.state,
      zip: member.zip || originalFamily.zip,
      // Set husband/wife information based on member gender
      ...(member.gender === 'male' ? {
        husbandFirstName: member.firstName,
        husbandHebrewName: member.hebrewFirstName || null,
        husbandFatherHebrewName: fatherHebrewName,
        husbandCellPhone: null,
        wifeFirstName: spouseFirstName || null,
        wifeHebrewName: member.spouseHebrewName || null,
        wifeFatherHebrewName: member.spouseFatherHebrewName || null,
        wifeCellPhone: member.spouseCellPhone || null
      } : {
        husbandFirstName: spouseFirstName || null,
        husbandHebrewName: member.spouseHebrewName || null,
        husbandFatherHebrewName: member.spouseFatherHebrewName || null,
        husbandCellPhone: member.spouseCellPhone || null,
        wifeFirstName: member.firstName,
        wifeHebrewName: member.hebrewFirstName || null,
        wifeFatherHebrewName: fatherHebrewName,
        wifeCellPhone: null
      }),
      currentPlan: paymentPlanNumber ?? undefined,
      paymentPlanId: paymentPlanId || undefined,
      currentPayment: 0,
      openBalance: 0,
      parentFamilyId: originalFamily._id,
      organizationId: ctx!.organizationId,
    })

    // Create spouse as a member if name provided
    if (spouseFirstName || spouseName) {
      await FamilyMember.create({
        familyId: newFamily._id,
        firstName: spouseFirstName,
        lastName: spouseLastName,
        hebrewFirstName: member.spouseHebrewName || null,
        birthDate: new Date(weddingDate), // Approximate, can be updated later
        gender: member.gender === 'male' ? 'female' : 'male'
      , organizationId: ctx!.organizationId})
    }

    // Move the member to the new family
    member.familyId = newFamily._id
    member.convertedToFamily = true
    await member.save()

    await audit({
      organizationId: ctx!.organizationId,
      userId: ctx!.userId,
      action: 'member.convert_to_family',
      resourceType: 'Family',
      resourceId: newFamily._id,
      metadata: {
        sourceFamilyId: id,
        memberId,
        newFamilyName,
      },
      request,
    })

    return {
      status: 201,
      data: {
        message: 'Member converted to family successfully',
        newFamily: newFamily,
        member: member,
      },
    }
  },
})

