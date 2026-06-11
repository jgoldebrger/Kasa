/**
 * Deterministic E2E seed data. Used by e2e/start-dev.ts before Next boots.
 */
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'

export const E2E_SECRETS = {
  auth: 'e2e-test-auth-secret-do-not-use-in-prod',
  encryption: 'e2e-test-encryption-key-do-not-use',
} as const

export const E2E_USER = {
  email: 'e2e@kasa.test',
  password: 'E2eTestPass123!',
  name: 'E2E Test User',
} as const

/** Deterministic TOTP secret for E2E login + platform-admin 2FA gate. */
export const E2E_TOTP_SECRET = 'KASAE2ETESTSECRETBASE32XXXXXX'

/** Org member (not admin) — used for RBAC / security role-matrix tests. */
export const E2E_MEMBER = {
  email: 'e2e-member@kasa.test',
  password: 'E2eMemberPass123!',
  name: 'E2E Member User',
} as const

export const E2E_ORGS = {
  alpha: {
    name: 'E2E Org Alpha',
    slug: 'e2e-org-alpha',
    markerFamily: 'Alpha Marker Family',
  },
  beta: {
    name: 'E2E Org Beta',
    slug: 'e2e-org-beta',
    markerFamily: 'Beta Marker Family',
  },
} as const

export const E2E_FIXTURES = {
  taskTitle: 'E2E Seed Task',
  memberFirstName: 'E2E',
  memberLastName: 'Member',
  eventTypeName: 'Bar Mitzvah',
  eventTypeKey: 'bar_mitzvah',
  paymentPlanName: 'Standard Plan',
  statementNumber: 'STMT-E2E-001',
  inviteRequestEmail: 'pending-invite@example.com',
} as const

export type SeedOptions = {
  /** Extra families in Alpha org to exercise >1000 list pagination. */
  bulkFamilyCount?: number
}

export async function seedE2eDatabase(mongoUri: string, opts: SeedOptions = {}): Promise<void> {
  process.env.MONGODB_URI = mongoUri
  process.env.ENCRYPTION_KEY ||= E2E_SECRETS.encryption
  await mongoose.connect(mongoUri)

  const {
    User,
    Organization,
    OrgMembership,
    Family,
    FamilyMember,
    PaymentPlan,
    Payment,
    Task,
    LifecycleEvent,
    LifecycleEventPayment,
    YearlyCalculation,
    Statement,
    InviteRequest,
  } = await import('../lib/models')

  await Promise.all([
    User.deleteMany({ email: { $in: [E2E_USER.email, E2E_MEMBER.email] } }),
    Organization.deleteMany({ slug: { $in: [E2E_ORGS.alpha.slug, E2E_ORGS.beta.slug] } }),
    InviteRequest.deleteMany({ email: E2E_FIXTURES.inviteRequestEmail }),
  ])

  const hashedOwnerPassword = await bcrypt.hash(E2E_USER.password, 10)
  const user = await User.create({
    email: E2E_USER.email,
    hashedPassword: hashedOwnerPassword,
    name: E2E_USER.name,
    twoFactorEnabled: true,
    // Plaintext is fine in ephemeral E2E mongo; auth decrypt() passes it through.
    twoFactorSecret: E2E_TOTP_SECRET,
  })

  const hashedMemberPassword = await bcrypt.hash(E2E_MEMBER.password, 10)
  const memberUser = await User.create({
    email: E2E_MEMBER.email,
    hashedPassword: hashedMemberPassword,
    name: E2E_MEMBER.name,
  })

  const orgAlpha = await Organization.create({
    name: E2E_ORGS.alpha.name,
    slug: E2E_ORGS.alpha.slug,
    ownerId: user._id,
    timezone: 'UTC',
    currency: 'USD',
    locale: 'en-US',
  })

  const orgBeta = await Organization.create({
    name: E2E_ORGS.beta.name,
    slug: E2E_ORGS.beta.slug,
    ownerId: user._id,
    timezone: 'UTC',
    currency: 'USD',
    locale: 'en-US',
  })

  await OrgMembership.insertMany([
    { userId: user._id, organizationId: orgAlpha._id, role: 'owner' },
    { userId: user._id, organizationId: orgBeta._id, role: 'owner' },
    { userId: memberUser._id, organizationId: orgAlpha._id, role: 'member' },
  ])

  user.lastActiveOrganizationId = orgAlpha._id
  await user.save()
  memberUser.lastActiveOrganizationId = orgAlpha._id
  await memberUser.save()

  const weddingDate = new Date('2015-06-01')
  const markerFamilies = await Family.insertMany([
    {
      organizationId: orgAlpha._id,
      name: E2E_ORGS.alpha.markerFamily,
      weddingDate,
      email: 'alpha-marker@example.com',
    },
    {
      organizationId: orgBeta._id,
      name: E2E_ORGS.beta.markerFamily,
      weddingDate,
    },
  ])

  const alphaFamily = markerFamilies[0]
  const bulkCount = opts.bulkFamilyCount ?? 0
  if (bulkCount > 0) {
    const bulkFamilies = Array.from({ length: bulkCount }, (_, i) => ({
      organizationId: orgAlpha._id,
      name: `Bulk Family ${String(i + 1).padStart(4, '0')}`,
      weddingDate,
    }))
    await Family.insertMany(bulkFamilies)
  }

  const plan = await PaymentPlan.create({
    organizationId: orgAlpha._id,
    name: E2E_FIXTURES.paymentPlanName,
    planNumber: 1,
    yearlyPrice: 1200,
  })

  alphaFamily.paymentPlanId = plan._id
  await alphaFamily.save()

  const member = await FamilyMember.create({
    organizationId: orgAlpha._id,
    familyId: alphaFamily._id,
    firstName: E2E_FIXTURES.memberFirstName,
    lastName: E2E_FIXTURES.memberLastName,
    gender: 'male',
    birthDate: new Date('2010-01-15'),
  })

  const now = new Date()
  const year = now.getFullYear()

  await LifecycleEvent.create({
    organizationId: orgAlpha._id,
    type: E2E_FIXTURES.eventTypeKey,
    name: E2E_FIXTURES.eventTypeName,
    amount: 500,
  })

  await Promise.all([
    Payment.create({
      organizationId: orgAlpha._id,
      familyId: alphaFamily._id,
      memberId: member._id,
      amount: 250,
      paymentDate: now,
      year,
      type: 'membership',
      paymentMethod: 'check',
      notes: 'E2E seed payment',
    }),
    Task.create({
      organizationId: orgAlpha._id,
      title: E2E_FIXTURES.taskTitle,
      description: 'Created by E2E seed',
      dueDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      email: E2E_USER.email,
      priority: 'medium',
      status: 'pending',
      relatedFamilyId: alphaFamily._id,
      relatedMemberId: member._id,
    }),
    LifecycleEventPayment.create({
      organizationId: orgAlpha._id,
      familyId: alphaFamily._id,
      memberId: member._id,
      eventType: E2E_FIXTURES.eventTypeKey,
      eventDate: now,
      amount: 500,
      year,
      notes: 'E2E seed event',
    }),
    YearlyCalculation.create({
      organizationId: orgAlpha._id,
      year,
      calculatedIncome: 2500,
      calculatedExpenses: 500,
      balance: 2000,
      totalIncome: 2500,
      totalExpenses: 500,
    }),
    Statement.create({
      organizationId: orgAlpha._id,
      familyId: alphaFamily._id,
      statementNumber: E2E_FIXTURES.statementNumber,
      date: now,
      fromDate: new Date(year, 0, 1),
      toDate: now,
      openingBalance: 0,
      income: 250,
      withdrawals: 0,
      expenses: 0,
      cycleCharges: 0,
      closingBalance: 250,
    }),
    InviteRequest.create({
      email: E2E_FIXTURES.inviteRequestEmail,
      name: 'Pending Invite User',
      message: 'E2E seed invite request',
      status: 'pending',
    }),
  ])

  await mongoose.disconnect()
}
