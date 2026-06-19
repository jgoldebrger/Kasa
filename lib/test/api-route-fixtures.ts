import bcrypt from 'bcryptjs'
import { setupMongo } from './mongo-memory'

export interface RouteFixtureIds {
  familyId: string
  memberId: string
  taskId: string
  disposableTaskId: string
  paymentPlanId: string
  lifecycleEventTypeId: string
  statementId: string
  withdrawalId: string
  savedReportId: string
  betaFamilyId: string
  membershipId: string
  memberMembershipId: string
  memberUserId: string
  savedPaymentMethodId: string
}

export interface ApiTestContext {
  userId: string
  email: string
  userName: string
  orgId: string
  betaOrgId: string
  signupCode: string
  fixtures: RouteFixtureIds
}

const PLACEHOLDER_IDS: Record<string, string> = {
  id: '507f1f77bcf86cd799439011',
  memberId: '507f1f77bcf86cd799439012',
  familyId: '507f1f77bcf86cd799439011',
  taskId: '507f1f77bcf86cd799439013',
  withdrawalId: '507f1f77bcf86cd799439014',
  kind: 'families',
}

function resolveParamSegment(template: string, param: string, fixtures: RouteFixtureIds): string {
  if (param === 'memberId') return fixtures.memberId
  if (param === 'taskId') return fixtures.taskId
  if (param === 'withdrawalId') return fixtures.withdrawalId
  if (param === 'familyId') return fixtures.familyId
  if (param === 'kind') return 'families'
  if (param === 'id') {
    if (template.includes('/payment-plans/')) return fixtures.paymentPlanId
    if (template.includes('/lifecycle-event-types/')) return fixtures.lifecycleEventTypeId
    if (template.includes('/reports/saved/')) return fixtures.savedReportId
    if (template.includes('/tasks/')) return fixtures.taskId
    if (template.includes('/statements/')) return fixtures.statementId
    return fixtures.familyId
  }
  return PLACEHOLDER_IDS[param] ?? fixtures.familyId
}

export function resolveRoutePath(template: string, fixtures: RouteFixtureIds): string {
  const segments = template.split('/')
  const resolved = segments.map((seg) => {
    if (!seg.startsWith(':')) return seg
    return resolveParamSegment(template, seg.slice(1), fixtures)
  })
  return resolved.join('/')
}

export function extractRouteParams(template: string, resolvedPath: string): Record<string, string> {
  const tParts = template.split('/').filter(Boolean)
  const rParts = resolvedPath.split('/').filter(Boolean)
  const params: Record<string, string> = {}
  for (let i = 0; i < tParts.length; i++) {
    if (tParts[i].startsWith(':')) {
      params[tParts[i].slice(1)] = rParts[i] ?? ''
    }
  }
  return params
}

export function defaultRouteQuery(template: string, signupCode: string): string {
  const year = new Date().getFullYear()
  if (template === '/api/auth/signup') return `?code=${encodeURIComponent(signupCode)}`
  if (template === '/api/tax-receipts') return `?year=${year}`
  if (template === '/api/search') return '?q=Marker'
  if (template === '/api/audit-log') return '?limit=5'
  if (template === '/api/notifications') return '?limit=10'
  if (template === '/api/families') return '?limit=5'
  if (template === '/api/family-members/all') return ''
  if (template === '/api/statements') return '?limit=5'
  if (template.startsWith('/api/reports/pl')) {
    return `?fromDate=${year}-01-01&toDate=${year}-12-31`
  }
  if (template.includes('/members/') && template.endsWith('/statements')) return ''
  if (template.includes('/members/') && template.endsWith('/payments')) return ''
  if (template.includes('/members/') && template.endsWith('/balance')) return ''
  if (template === '/api/tax-receipts/zip') return `?year=${year}`
  if (template.includes('/tax-receipts/') && template.endsWith('/pdf')) return `?year=${year}`
  return ''
}

export async function seedApiRouteFixtures(): Promise<ApiTestContext> {
  await setupMongo()

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
    Withdrawal,
    SavedReport,
    InviteRequest,
    Invite,
    CycleConfig,
    EmailConfig,
    SavedPaymentMethod,
  } = await import('../models')

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const email = `api-route-${suffix}@example.com`
  const signupCode = `API-${suffix.slice(0, 8)}`

  await Promise.all([
    User.deleteMany({ email: /@example\.com$/ }),
    Organization.deleteMany({ slug: /^api-route-org-/ }),
    InviteRequest.deleteMany({ signupCode: /^API-/ }),
  ])

  const hashedPassword = await bcrypt.hash('ApiRouteTestPass123!', 10)
  const user = await User.create({
    email,
    hashedPassword,
    name: 'API Route Tester',
    twoFactorEnabled: false,
  })

  const org = await Organization.create({
    name: 'API Route Org',
    slug: `api-route-org-${suffix}`,
    ownerId: user._id,
    timezone: 'UTC',
    currency: 'USD',
    locale: 'en-US',
    stripeConnectAccountId: 'acct_test_api_route_seed',
    stripeConnectOnboardingStatus: 'complete',
    stripeConnectChargesEnabled: true,
    stripeConnectPayoutsEnabled: true,
    stripeConnectDetailsSubmitted: true,
  })

  const betaOrg = await Organization.create({
    name: 'API Route Org Beta',
    slug: `api-route-org-beta-${suffix}`,
    ownerId: user._id,
    timezone: 'UTC',
    currency: 'USD',
    locale: 'en-US',
  })

  const ownerMembership = await OrgMembership.create({
    userId: user._id,
    organizationId: org._id,
    role: 'owner',
  })
  await OrgMembership.create({
    userId: user._id,
    organizationId: betaOrg._id,
    role: 'owner',
  })

  const memberUser = await User.create({
    email: `member-${suffix}@example.com`,
    hashedPassword,
    name: 'API Route Member',
  })
  const memberMembership = await OrgMembership.create({
    userId: memberUser._id,
    organizationId: org._id,
    role: 'member',
  })

  user.lastActiveOrganizationId = org._id
  await user.save()

  const now = new Date()
  const weddingDate = new Date('2015-06-01')
  const family = await Family.create({
    organizationId: org._id,
    name: 'API Route Marker Family',
    weddingDate,
    email: 'marker@example.com',
  })

  const betaFamily = await Family.create({
    organizationId: betaOrg._id,
    name: 'API Route Disposable Family',
    weddingDate,
  })

  const plan = await PaymentPlan.create({
    organizationId: org._id,
    name: 'API Route Plan',
    planNumber: 1,
    yearlyPrice: 1200,
  })

  family.paymentPlanId = plan._id
  await family.save()

  const savedPaymentMethod = await SavedPaymentMethod.create({
    organizationId: org._id,
    familyId: family._id,
    stripePaymentMethodId: 'pm_probemock',
    last4: '4242',
    cardType: 'visa',
    expiryMonth: 12,
    expiryYear: 2030,
    isDefault: true,
    isActive: true,
  })

  await Invite.create({
    organizationId: org._id,
    email: `pending-invite-${suffix}@example.com`,
    role: 'member',
    token: `inv_${suffix}`,
    invitedById: user._id,
    expiresAt: new Date(now.getTime() + 7 * 86400000),
  })

  const member = await FamilyMember.create({
    organizationId: org._id,
    familyId: family._id,
    firstName: 'Route',
    lastName: 'Member',
    gender: 'male',
    birthDate: new Date('2010-03-01'),
  })

  const year = now.getFullYear()

  const eventType = await LifecycleEvent.create({
    organizationId: org._id,
    type: 'bar_mitzvah',
    name: 'Bar Mitzvah',
    amount: 500,
  })

  const taskDue = new Date(now.getTime() + 7 * 86400000)
  const task = await Task.create({
    organizationId: org._id,
    title: 'API Route Task',
    description: 'seed',
    dueDate: taskDue,
    email,
    priority: 'medium',
    status: 'pending',
    relatedFamilyId: family._id,
  })

  const disposableTask = await Task.create({
    organizationId: org._id,
    title: 'API Route Disposable Task',
    description: 'delete probe',
    dueDate: taskDue,
    email,
    priority: 'low',
    status: 'pending',
  })

  await Payment.create({
    organizationId: org._id,
    familyId: family._id,
    memberId: member._id,
    amount: 100,
    paymentDate: now,
    year,
    type: 'membership',
    paymentMethod: 'check',
    stripePaymentIntentId: 'pi_apiprobemock',
  })

  const statement = await Statement.create({
    organizationId: org._id,
    familyId: family._id,
    statementNumber: `API-STMT-${suffix}`,
    date: now,
    fromDate: new Date(year, 0, 1),
    toDate: now,
    openingBalance: 0,
    income: 100,
    withdrawals: 0,
    expenses: 0,
    cycleCharges: 0,
    closingBalance: 100,
  })

  const withdrawal = await Withdrawal.create({
    organizationId: org._id,
    familyId: family._id,
    amount: 25,
    withdrawalDate: now,
    reason: 'api-route seed',
  })

  const savedReport = await SavedReport.create({
    organizationId: org._id,
    name: `API Saved ${suffix}`,
    createdBy: user._id,
    source: 'payments',
    config: {
      aggregate: 'count',
      dateRange: { from: `${year}-01-01`, to: `${year}-12-31` },
    },
  })

  await Promise.all([
    LifecycleEventPayment.create({
      organizationId: org._id,
      familyId: family._id,
      memberId: member._id,
      eventType: 'bar_mitzvah',
      eventDate: now,
      amount: 50,
      year,
    }),
    YearlyCalculation.create({
      organizationId: org._id,
      year,
      calculatedIncome: 100,
      calculatedExpenses: 50,
      balance: 50,
      totalIncome: 100,
      totalExpenses: 50,
      byPlan: [],
      byEvent: [],
      totalPayments: 100,
      planIncome: 100,
    }),
    InviteRequest.create({
      email: `invite-${suffix}@example.com`,
      name: 'Invite Target',
      message: 'api route seed',
      status: 'approved',
      signupCode,
      signupCodeExpiresAt: new Date(now.getTime() + 86400000),
    }),
    CycleConfig.create({
      organizationId: org._id,
      isActive: true,
      cycleAutoRollover: false,
      cycleCalendar: 'gregorian',
      cycleStartMonth: 1,
      cycleStartDay: 1,
    }),
    EmailConfig.create({
      organizationId: org._id,
      email: 'sender@example.com',
      password: 'encrypted-placeholder',
      fromName: 'API Route Org',
      isActive: true,
    }),
  ])

  return {
    userId: user._id.toString(),
    email,
    userName: user.name ?? 'API Route Tester',
    orgId: org._id.toString(),
    betaOrgId: betaOrg._id.toString(),
    signupCode,
    fixtures: {
      familyId: family._id.toString(),
      memberId: member._id.toString(),
      taskId: task._id.toString(),
      disposableTaskId: disposableTask._id.toString(),
      paymentPlanId: plan._id.toString(),
      lifecycleEventTypeId: eventType._id.toString(),
      statementId: statement._id.toString(),
      withdrawalId: withdrawal._id.toString(),
      savedReportId: savedReport._id.toString(),
      betaFamilyId: betaFamily._id.toString(),
      membershipId: ownerMembership._id.toString(),
      memberMembershipId: memberMembership._id.toString(),
      memberUserId: memberUser._id.toString(),
      savedPaymentMethodId: savedPaymentMethod._id.toString(),
    },
  }
}

export async function teardownApiRouteFixtures(): Promise<void> {
  const { teardownMongo } = await import('./mongo-memory')
  await teardownMongo()
}
