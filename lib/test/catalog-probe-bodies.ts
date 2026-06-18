import type { ApiRouteEntry } from '@/security/catalog/types'
import type { ApiTestContext } from './api-route-fixtures'

function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

/** JSON body that exercises the success path for catalogued mutating routes. */
export function catalogSuccessBody(route: ApiRouteEntry, ctx: ApiTestContext): unknown {
  const f = ctx.fixtures
  const year = new Date().getFullYear()
  const today = isoToday()

  const key = `${route.method} ${route.path}`

  const bodies: Record<string, unknown> = {
    'POST /api/families': {
      name: `Probe Family ${Date.now()}`,
      weddingDate: '2018-01-01',
      husbandFirstName: 'Probe',
      husbandLastName: 'Family',
      paymentPlanId: f.paymentPlanId,
    },
    'PUT /api/families/:id': {
      name: 'API Route Marker Family (updated)',
      weddingDate: '2015-06-01',
      email: 'marker@example.com',
    },
    'POST /api/families/:id/members': {
      firstName: 'Deep',
      lastName: 'Probe',
      birthDate: '2012-04-15',
      gender: 'female',
    },
    'PUT /api/families/:id/members/:memberId': {
      firstName: 'Route',
      lastName: 'Member',
      birthDate: '2010-03-01',
      gender: 'male',
    },
    'POST /api/families/:id/payments': {
      amount: 25,
      paymentDate: today,
      year,
      type: 'membership',
      paymentMethod: 'check',
      memberId: f.memberId,
    },
    'POST /api/families/:id/lifecycle-events': {
      eventType: 'bar_mitzvah',
      eventDate: today,
      year,
    },
    'POST /api/families/:id/withdrawals': {
      amount: 10,
      withdrawalDate: today,
      reason: 'deep probe',
    },
    'POST /api/families/bulk': {
      action: 'setPaymentPlan',
      ids: [f.familyId],
      paymentPlanId: f.paymentPlanId,
    },
    'POST /api/families/:id/charge-saved-card': {
      savedPaymentMethodId: f.savedPaymentMethodId,
      amount: 25,
      paymentDate: today,
      year,
      type: 'membership',
    },
    'POST /api/families/:id/saved-payment-methods': {
      paymentMethodId: 'pm_probemock',
      paymentIntentId: 'pi_apiprobemock',
      setAsDefault: true,
    },
    'DELETE /api/families/:id/saved-payment-methods': undefined,
    'POST /api/payment-plans': { name: `Probe Plan ${Date.now()}`, yearlyPrice: 100 },
    'PATCH /api/payment-plans/:id': { name: 'API Route Plan', yearlyPrice: 1200 },
    'POST /api/lifecycle-event-types': {
      type: `probe_${Date.now()}`,
      name: 'Probe Event',
      amount: 10,
    },
    'PATCH /api/lifecycle-event-types/:id': { name: 'Bar Mitzvah', amount: 500 },
    'POST /api/tasks': {
      title: `Deep Probe Task ${Date.now()}`,
      dueDate: today,
      email: ctx.email,
      priority: 'low',
      status: 'pending',
    },
    'PUT /api/tasks/:id': { status: 'completed', title: 'Updated probe task' },
    'POST /api/calculations': { year },
    'POST /api/cycle-config': {
      cycleCalendar: 'gregorian',
      cycleStartMonth: 1,
      cycleStartDay: 1,
      cycleAutoRollover: false,
    },
    'POST /api/notifications': { all: true },
    'PATCH /api/org-members': {
      membershipId: f.memberMembershipId,
      role: 'admin',
    },
    'PATCH /api/user': { name: 'API Route Probe' },
    'PATCH /api/user/preferences': { emailNotifications: true },
    'PATCH /api/user/password': {
      currentPassword: 'ApiRouteTestPass123!',
      newPassword: 'ApiRouteTestPass123!',
    },
    'POST /api/user/2fa/setup': { password: 'ApiRouteTestPass123!' },
    'POST /api/email-config': {
      email: ctx.email,
      password: 'app-password-probe',
      fromName: 'API Route Org',
    },
    'PUT /api/email-config': {
      email: ctx.email,
      password: 'app-password-probe',
      fromName: 'API Route Org',
    },
    'POST /api/email-config/test': {},
    'PUT /api/organizations/automation': {
      barMitzvahAutoAssignPlanId: f.paymentPlanId,
      barMitzvahAutoCreateEventTypeId: f.lifecycleEventTypeId,
      addChildAutoCreateEventTypeId: f.lifecycleEventTypeId,
      monthlyStatementAutoGenerate: false,
      monthlyStatementAutoEmail: false,
    },
    'PUT /api/organizations/branding': { accentColor: '#2563eb' },
    'PUT /api/organizations/letterhead': {
      letterheadName: 'API Route Org',
      letterheadAddress: '123 Test St',
      letterheadCity: 'Testville',
    },
    'PATCH /api/organizations/current': { locale: 'en-US' },
    'POST /api/organizations': { name: `Probe Org ${Date.now()}` },
    'POST /api/reports/run': {
      source: 'payments',
      aggregate: 'count',
      fromDate: `${year}-01-01`,
      toDate: `${year}-12-31`,
    },
    'POST /api/reports/saved': {
      name: `Probe Report ${Date.now()}`,
      config: {
        source: 'payments',
        aggregate: 'count',
        fromDate: `${year}-01-01`,
        toDate: `${year}-12-31`,
      },
    },
    'PATCH /api/reports/saved/:id': {
      name: 'API Saved Report',
      config: {
        source: 'payments',
        aggregate: 'count',
        fromDate: `${year}-01-01`,
        toDate: `${year}-12-31`,
      },
    },
    'POST /api/statements': {
      familyId: f.familyId,
      fromDate: `${year}-01-01`,
      toDate: today,
    },
    'POST /api/statements/generate-pdf': {
      statement: { _id: f.statementId },
      familyName: 'API Route Marker Family',
    },
    'POST /api/statements/generate-monthly': {},
    'POST /api/statements/auto-generate': {},
    'POST /api/statements/send-emails': {},
    'POST /api/statements/send-monthly-emails': {},
    'POST /api/statements/send-single-email': { familyId: f.familyId },
    'POST /api/tax-receipts/email': { year, familyIds: [f.familyId] },
    'POST /api/members/:memberId/statements': {
      fromDate: `${year}-01-01`,
      toDate: today,
      openingBalance: 0,
    },
    'POST /api/dues-recommendation': { yearlyPrice: 1200, memberCount: 1 },
    'POST /api/stripe/create-payment-intent': { familyId: f.familyId, amount: 50 },
    'POST /api/stripe/confirm-payment': {
      paymentIntentId: 'pi_apiprobemock',
      familyId: f.familyId,
      amount: 50,
      paymentDate: today,
      year,
      type: 'membership',
    },
    'POST /api/auth/signup': {
      inviteCode: ctx.signupCode,
      password: 'ApiRouteTestPass123!',
      name: 'Invite Target',
    },
    'POST /api/auth/request-invite': {
      email: `request-${Date.now()}@example.com`,
      name: 'Requester',
      message: 'api route probe',
    },
    'POST /api/auth/precheck-2fa': { email: ctx.email, password: 'ApiRouteTestPass123!' },
    'POST /api/auth/reset-password': { email: 'nobody@example.com' },
    'PUT /api/auth/reset-password': { token: 'invalid-token', password: 'ApiRouteTestPass123!' },
    'POST /api/auth/invite': { email: `org-invite-${Date.now()}@example.com`, role: 'member' },
    'PUT /api/auth/invite': {
      token: 'invalid-token',
      password: 'ApiRouteTestPass123!',
      name: 'Invited',
    },
    'POST /api/trash/purge-all': {},
    'POST /api/trash/:kind/:id/restore': {},
    'PATCH /api/admin/invite-requests': { status: 'rejected' },
  }

  return bodies[key]
}

export function catalogSuccessQuery(route: ApiRouteEntry, ctx: ApiTestContext): string | null {
  const year = new Date().getFullYear()
  const key = `${route.method} ${route.path}`

  if (key === 'GET /api/tax-receipts/zip') return `?year=${year}`
  if (key === 'GET /api/tax-receipts/:familyId/pdf') return `?year=${year}`
  if (key === 'GET /api/dues-recommendation') return ''
  if (key === 'DELETE /api/org-members') {
    return `?id=${encodeURIComponent('000000000000000000000099')}`
  }

  return null
}
