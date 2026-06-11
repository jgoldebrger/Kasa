import connectDB from './database'
import { Family, FamilyMember, Organization, PaymentPlan } from './models'
import { familyMemberBatches } from './org-pagination'
import { startOfDayInTimeZone } from './date-utils'

/**
 * Convert members to families on their wedding date.
 * Must be scoped to a single organization — pass the active orgId.
 * For cron use, iterate over all orgs and call this per-org.
 *
 * Plan assignment uses the org's `weddingConversionDefaultPlanId`
 * setting. If unset, new families are created with no plan and the
 * admin assigns one manually — no hardcoded years-married brackets.
 */
export async function convertMembersOnWeddingDate(organizationId: string) {
  let converted = 0

  try {
    await connectDB()

    const org = await Organization.findById(organizationId)
      .select('weddingConversionDefaultPlanId timezone')
      .lean<any>()
    const startOfToday = startOfDayInTimeZone(org?.timezone)

    const memberFilter = {
      weddingDate: { $lte: startOfToday },
      convertedToFamily: { $ne: true },
    }

    console.log(`Scanning members due for conversion on ${startOfToday.toISOString()}`)

    // Resolve the org's default conversion plan once per batch. If unset
    // or pointing at a deleted plan, the resolved values stay null and
    // every new family in this batch is created without a plan.
    let defaultPlanId: any = null
    let defaultPlanNumber: number | null = null
    if (org?.weddingConversionDefaultPlanId) {
      const plan = await PaymentPlan.findOne({
        _id: org.weddingConversionDefaultPlanId,
        organizationId,
      })
        .select('_id planNumber')
        .lean<any>()
      if (plan) {
        defaultPlanId = plan._id
        defaultPlanNumber = plan.planNumber ?? null
      }
    }

    async function releaseClaim(memberId: string) {
      await FamilyMember.updateOne(
        { _id: memberId, organizationId },
        { $unset: { convertedToFamily: '' } },
      )
    }

    for await (const membersToConvert of familyMemberBatches(organizationId, memberFilter)) {
    for (const member of membersToConvert) {
      let createdFamilyId: string | null = null
      try {
        // Claim the member atomically before doing any side-effecting
        // work below. Without this, a transient failure in the delete
        // step would leave the member with `convertedToFamily: false`
        // while a NEW family had already been created — re-running the
        // cron would create a duplicate family for the same wedding.
        const claim = await FamilyMember.findOneAndUpdate(
          { _id: member._id, organizationId, convertedToFamily: { $ne: true } },
          { $set: { convertedToFamily: true } },
          { new: false },
        )
        if (!claim) {
          continue
        }

        const originalFamily = await Family.findOne({ _id: member.familyId, organizationId })
        if (!originalFamily) {
          console.error(`Original family not found for member ${member._id}`)
          await releaseClaim(String(member._id))
          continue
        }

        const weddingDate = claim.weddingDate
        if (!weddingDate) {
          await releaseClaim(String(member._id))
          continue
        }

        const spouseFirstName = claim.spouseFirstName || ''
        const spouseLastName = claim.spouseLastName || claim.lastName
        const newFamilyName = spouseFirstName
          ? `${member.firstName} ${member.lastName} & ${spouseFirstName} ${spouseLastName}`.trim()
          : `${member.firstName} ${member.lastName} Family`

        const fatherHebrewName = member.gender === 'male'
          ? originalFamily.husbandHebrewName || null
          : originalFamily.wifeHebrewName || null

        const newFamily = await Family.create({
          name: newFamilyName,
          weddingDate,
          address: member.address || originalFamily.address,
          street: member.address || originalFamily.street || originalFamily.address,
          phone: member.phone || originalFamily.phone,
          email: member.email || originalFamily.email,
          city: member.city || originalFamily.city,
          state: member.state || originalFamily.state,
          zip: member.zip || originalFamily.zip,
          ...(member.gender === 'male'
            ? {
                husbandFirstName: member.firstName,
                husbandHebrewName: member.hebrewFirstName || null,
                husbandFatherHebrewName: fatherHebrewName,
                husbandCellPhone: member.phone || null,
                wifeFirstName: spouseFirstName || null,
                wifeHebrewName: member.spouseHebrewName || null,
                wifeFatherHebrewName: member.spouseFatherHebrewName || null,
                wifeCellPhone: member.spouseCellPhone || null,
              }
            : {
                husbandFirstName: spouseFirstName || null,
                husbandHebrewName: member.spouseHebrewName || null,
                husbandFatherHebrewName: member.spouseFatherHebrewName || null,
                husbandCellPhone: member.spouseCellPhone || null,
                wifeFirstName: member.firstName,
                wifeHebrewName: member.hebrewFirstName || null,
                wifeFatherHebrewName: fatherHebrewName,
                wifeCellPhone: member.phone || null,
              }),
          currentPlan: defaultPlanNumber ?? undefined,
          paymentPlanId: defaultPlanId || undefined,
          currentPayment: 0,
          openBalance: 0,
          parentFamilyId: originalFamily._id,
          organizationId,
        })
        createdFamilyId = String(newFamily._id)

        if (spouseFirstName) {
          await FamilyMember.create({
            familyId: newFamily._id,
            firstName: spouseFirstName,
            lastName: spouseLastName,
            hebrewFirstName: member.spouseHebrewName || null,
            birthDate: weddingDate,
            gender: member.gender === 'male' ? 'female' : 'male',
            organizationId,
          })
        }

        // Remove the original member row — they now own the new family.
        // `convertedToFamily: true` was already persisted via the atomic
        // claim above, so a failure here only leaves a harmless tombstone.
        await FamilyMember.deleteOne({ _id: member._id, organizationId })

        converted += 1
        console.log(`Successfully converted ${member.firstName} ${member.lastName} to new family: ${newFamily.name}`)
      } catch (error: any) {
        console.error(`Error converting member ${member._id} to family:`, error)
        if (!createdFamilyId) {
          await releaseClaim(String(member._id)).catch(() => {})
        }
      }
    }
    }

    return { converted }
  } catch (error) {
    console.error('Error in wedding date conversion:', error)
    throw error
  }
}
