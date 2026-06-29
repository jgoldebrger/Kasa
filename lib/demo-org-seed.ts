/**
 * Shared demo sandbox org seed — used by the admin API and scripts/seed-demo-org.ts.
 */

import {
  Family,
  FamilyMember,
  LifecycleEvent,
  Organization,
  OrgMembership,
  Payment,
  PaymentPlan,
} from '@/lib/models'

export const DEMO_ORG_SLUG = 'kasa-demo-sandbox'

export interface DemoOrgSeedResult {
  organizationId: string
  slug: string
  name: string
  created: boolean
  familyCount: number
  paymentCount: number
}

export async function seedDemoSandboxOrg(ownerUserId: string): Promise<DemoOrgSeedResult> {
  const existing = await Organization.findOne({ slug: DEMO_ORG_SLUG }).lean<{
    _id: { toString(): string }
    name?: string
  }>()
  if (existing) {
    const [familyCount, paymentCount] = await Promise.all([
      Family.countDocuments({ organizationId: existing._id }),
      Payment.countDocuments({ organizationId: existing._id }),
    ])
    return {
      organizationId: existing._id.toString(),
      slug: DEMO_ORG_SLUG,
      name: existing.name || 'Kasa Demo Sandbox',
      created: false,
      familyCount,
      paymentCount,
    }
  }

  const org = await Organization.create({
    name: 'Kasa Demo Sandbox',
    slug: DEMO_ORG_SLUG,
    ownerId: ownerUserId,
    timezone: 'America/New_York',
    currency: 'USD',
    locale: 'en-US',
    setupCompletedAt: new Date(),
    demoSandbox: true,
    planTier: 'community',
    subscriptionStatus: 'active',
    trialEndsAt: new Date(Date.now() + 365 * 24 * 60 * 60_000),
  })

  await OrgMembership.create({
    userId: ownerUserId,
    organizationId: org._id,
    role: 'owner',
  })

  const plan = await PaymentPlan.create({
    organizationId: org._id,
    name: 'Annual Membership',
    planNumber: 1,
    yearlyPrice: 1200,
  })

  await LifecycleEvent.create({
    organizationId: org._id,
    type: 'bar_mitzvah',
    name: 'Bar Mitzvah',
    amount: 500,
  })

  const weddingDate = new Date('2012-06-15')
  const familySpecs = [
    { name: 'Cohen Family', email: 'cohen.demo@example.com' },
    { name: 'Levy Family', email: 'levy.demo@example.com' },
    { name: 'Goldstein Family', email: 'goldstein.demo@example.com' },
    { name: 'Rosen Family', email: 'rosen.demo@example.com' },
    { name: 'Katz Family', email: 'katz.demo@example.com' },
  ]

  const families = await Family.insertMany(
    familySpecs.map((f) => ({
      organizationId: org._id,
      name: f.name,
      email: f.email,
      weddingDate,
      paymentPlanId: plan._id,
    })),
  )

  const members = await FamilyMember.insertMany(
    families.flatMap((family, i) => [
      {
        organizationId: org._id,
        familyId: family._id,
        firstName: ['David', 'Sarah', 'Michael', 'Rachel', 'Jacob'][i],
        lastName: family.name.split(' ')[0],
        gender: i % 2 === 0 ? 'male' : 'female',
        birthDate: new Date(`${2005 + i}-03-10`),
      },
      {
        organizationId: org._id,
        familyId: family._id,
        firstName: ['Miriam', 'Aaron', 'Leah', 'Benjamin', 'Esther'][i],
        lastName: family.name.split(' ')[0],
        gender: i % 2 === 0 ? 'female' : 'male',
        birthDate: new Date(`${2008 + i}-08-20`),
      },
    ]),
  )

  void members

  const now = new Date()
  const year = now.getFullYear()
  const payments = []
  for (let i = 0; i < families.length; i++) {
    payments.push({
      organizationId: org._id,
      familyId: families[i]._id,
      amount: 1200,
      paymentDate: new Date(year, 0, 15 + i),
      paymentMethod: i % 2 === 0 ? 'check' : 'cash',
      type: 'membership',
      year,
      notes: 'Demo annual dues',
    })
    payments.push({
      organizationId: org._id,
      familyId: families[i]._id,
      amount: 150,
      paymentDate: new Date(year, 5, 1 + i),
      paymentMethod: 'cash',
      type: 'donation',
      year,
      notes: 'Demo building fund',
    })
  }
  await Payment.insertMany(payments)

  return {
    organizationId: org._id.toString(),
    slug: DEMO_ORG_SLUG,
    name: org.name,
    created: true,
    familyCount: families.length,
    paymentCount: payments.length,
  }
}
