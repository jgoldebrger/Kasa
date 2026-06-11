import { Suspense } from 'react'
import { Types } from 'mongoose'
import { requireServerOrgContext } from '@/lib/auth-server'
import { hasMinRole } from '@/lib/auth-helpers'
import { FAMILIES_LIST_PAGE_SIZE } from '@/lib/client/families-list'
import connectDB from '@/lib/database'
import { Family, FamilyMember, PaymentPlan } from '@/lib/models'
import { encodeCompoundCursor } from '@/lib/pagination'
import FamiliesView from './FamiliesView'
import FamiliesLoading from './loading'

export const dynamic = 'force-dynamic'

async function fetchInitialData(organizationId: string, isAdmin: boolean) {
  await connectDB()

  const familySelect = '-deletedAt -deletedBy -deletedKind -updatedAt -__v -organizationId'
  const [familyDocs, plans] = await Promise.all([
    Family.find({ organizationId })
      .select(familySelect)
      .sort({ name: 1, _id: 1 })
      .limit(FAMILIES_LIST_PAGE_SIZE + 1)
      .lean<any[]>(),
    isAdmin
      ? PaymentPlan.find({ organizationId }).sort({ planNumber: 1 }).lean<any[]>()
      : Promise.resolve([] as any[]),
  ])

  let nextCursor: string | null = null
  let families = familyDocs
  if (familyDocs.length > FAMILIES_LIST_PAGE_SIZE) {
    families = familyDocs.slice(0, FAMILIES_LIST_PAGE_SIZE)
    const last = families[families.length - 1]
    if (last) {
      nextCursor = encodeCompoundCursor({
        v: typeof last.name === 'string' ? last.name : null,
        id: String(last._id),
      })
    }
  }

  let countByFamily = new Map<string, number>()
  if (families.length > 0) {
    const familyIds = families.map((f) => f._id)
    const counts = await FamilyMember.aggregate([
      {
        $match: {
          familyId: { $in: familyIds },
          organizationId: new Types.ObjectId(String(organizationId)),
          deletedAt: null,
          convertedToFamily: { $ne: true },
        },
      },
      { $group: { _id: '$familyId', count: { $sum: 1 } } },
    ])
    for (const row of counts) countByFamily.set(String(row._id), row.count)
  }

  const initialFamilies = families.map((f) => {
    const plain = JSON.parse(JSON.stringify(f))
    plain.memberCount = countByFamily.get(String(f._id)) || 0
    if (!isAdmin) {
      delete plain.openBalance
      delete plain.currentPayment
      delete plain.currentPlan
      delete plain.paymentPlanId
    }
    return plain
  })

  const initialPaymentPlans = plans.map((p) => JSON.parse(JSON.stringify(p)))

  return { initialFamilies, initialPaymentPlans, initialFamiliesNextCursor: nextCursor }
}

async function FamiliesServer() {
  const ctx = await requireServerOrgContext()
  const isAdmin = hasMinRole(ctx.role, 'admin')
  let initialFamilies: any[] = []
  let initialPaymentPlans: any[] = []
  let initialFamiliesNextCursor: string | null = null
  try {
    const data = await fetchInitialData(ctx.organizationId, isAdmin)
    initialFamilies = data.initialFamilies
    initialPaymentPlans = data.initialPaymentPlans
    initialFamiliesNextCursor = data.initialFamiliesNextCursor
  } catch (err) {
    console.error('[families] server prefetch failed:', err)
  }
  return (
    <FamiliesView
      initialFamilies={initialFamilies}
      initialPaymentPlans={initialPaymentPlans}
      initialFamiliesNextCursor={initialFamiliesNextCursor}
      isAdmin={isAdmin}
    />
  )
}

export default function FamiliesPage() {
  return (
    <Suspense fallback={<FamiliesLoading />}>
      <FamiliesServer />
    </Suspense>
  )
}
