import { NextRequest } from 'next/server'
import type { ApiRouteEntry } from '../../security/catalog/types'
import { UPLOAD_FIXTURES } from '../../security/payloads/upload'
import {
  buildImportProbeRequest,
  importProbeLabels,
  type ImportProbeLabel,
} from './import-route-probes'
import {
  defaultRouteQuery,
  extractRouteParams,
  resolveRoutePath,
  type ApiTestContext,
  type RouteFixtureIds,
} from './api-route-fixtures'
import { catalogSuccessBody } from './catalog-probe-bodies'
import { probeBody } from './api-route-harness'

export type DeepProbe = {
  label: string
  buildRequest: (ctx: ApiTestContext) => NextRequest | Promise<NextRequest>
  params?: Record<string, string>
}

const ORIGIN = 'http://localhost:3000'

function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

function deepProbeBody(route: ApiRouteEntry, ctx: ApiTestContext): unknown {
  const catalog = catalogSuccessBody(route, ctx)
  if (catalog !== undefined) return catalog

  const base = probeBody(route, ctx)
  const f = ctx.fixtures
  const year = new Date().getFullYear()
  const today = isoToday()

  if (route.path === '/api/stripe/create-payment-intent' && route.method === 'POST') {
    return { familyId: f.familyId, amount: 50 }
  }
  if (route.path === '/api/stripe/confirm-payment' && route.method === 'POST') {
    return {
      paymentIntentId: 'pi_apiprobemock',
      familyId: f.familyId,
      amount: 50,
      paymentDate: today,
      year,
      type: 'membership',
    }
  }
  if (route.path === '/api/families/:id/payments' && route.method === 'POST') {
    return {
      amount: 25,
      paymentDate: today,
      year,
      type: 'membership',
      paymentMethod: 'check',
      memberId: f.memberId,
    }
  }
  if (route.path === '/api/families/:id/members' && route.method === 'POST') {
    return {
      firstName: 'Deep',
      lastName: 'Probe',
      birthDate: '2012-04-15',
      gender: 'female',
    }
  }
  if (route.path === '/api/families/:id/lifecycle-events' && route.method === 'POST') {
    return {
      eventType: 'bar_mitzvah',
      eventDate: today,
      year,
    }
  }
  if (route.path === '/api/families/:id/withdrawals' && route.method === 'POST') {
    return { amount: 10, withdrawalDate: today, reason: 'deep probe' }
  }
  if (route.path === '/api/families/:id' && route.method === 'PATCH') {
    return { name: 'API Route Marker Family (updated)' }
  }
  if (route.path === '/api/families/:id/members/:memberId' && route.method === 'PUT') {
    return {
      firstName: 'Route',
      lastName: 'Member',
      birthDate: '2010-03-01',
      gender: 'male',
    }
  }
  if (route.path === '/api/email-config' && route.method === 'POST') {
    return {
      email: ctx.email,
      password: 'app-password-probe',
      fromName: 'API Route Org',
    }
  }
  if (route.path === '/api/cycle-config' && route.method === 'POST') {
    return {
      cycleCalendar: 'gregorian',
      cycleStartMonth: 1,
      cycleStartDay: 1,
      cycleAutoRollover: false,
    }
  }
  if (route.path === '/api/organizations/automation' && route.method === 'PUT') {
    return {
      barMitzvahAutoAssignPlanId: f.paymentPlanId,
      barMitzvahAutoCreateEventTypeId: f.lifecycleEventTypeId,
      addChildAutoCreateEventTypeId: f.lifecycleEventTypeId,
      monthlyStatementAutoGenerate: false,
      monthlyStatementAutoEmail: false,
    }
  }
  if (route.path === '/api/organizations/branding' && route.method === 'PUT') {
    return { accentColor: '#2563eb' }
  }
  if (route.path === '/api/organizations/letterhead' && route.method === 'PUT') {
    return {
      letterheadName: 'API Route Org',
      letterheadAddress: '123 Test St',
      letterheadCity: 'Testville',
    }
  }
  if (route.path === '/api/organizations' && route.method === 'POST') {
    return { name: `Probe Org ${Date.now()}` }
  }
  if (route.path === '/api/calculations' && route.method === 'POST') {
    return { year }
  }
  if (route.path === '/api/notifications' && route.method === 'POST') {
    return { all: true }
  }
  if (route.path === '/api/org-members' && route.method === 'POST') {
    return { email: `invite-${Date.now()}@example.com`, role: 'member' }
  }
  if (route.path === '/api/user/password' && route.method === 'PATCH') {
    return {
      currentPassword: 'ApiRouteTestPass123!',
      newPassword: 'ApiRouteTestPass123!',
    }
  }
  if (route.path === '/api/user/2fa/setup' && route.method === 'POST') {
    return { password: 'ApiRouteTestPass123!' }
  }
  if (route.path === '/api/user/2fa' && route.method === 'PATCH') {
    // No pending enrollment in catalog fixtures — expect 400, not 401.
    return { action: 'enable', code: '123456' }
  }
  if (route.path === '/api/statements/generate-pdf' && route.method === 'POST') {
    return {
      statement: { _id: f.statementId },
      familyName: 'API Route Marker Family',
    }
  }
  if (route.path === '/api/statements' && route.method === 'POST') {
    return {
      familyId: f.familyId,
      fromDate: `${year}-01-01`,
      toDate: today,
    }
  }
  if (route.path === '/api/tax-receipts/zip' && route.method === 'POST') {
    return { year, familyIds: [f.familyId] }
  }
  if (route.path === '/api/tax-receipts/email' && route.method === 'POST') {
    return { year, familyIds: [f.familyId] }
  }
  if (route.path === '/api/tasks' && route.method === 'POST') {
    return {
      title: `Deep Probe Task ${Date.now()}`,
      dueDate: today,
      email: ctx.email,
      priority: 'low',
      status: 'pending',
    }
  }
  if (route.path === '/api/payment-plans/:id' && route.method === 'PATCH') {
    return { name: 'API Route Plan', yearlyPrice: 1200 }
  }
  if (route.path === '/api/lifecycle-event-types/:id' && route.method === 'PATCH') {
    return { name: 'Bar Mitzvah', amount: 500 }
  }
  if (route.path === '/api/reports/saved/:id' && route.method === 'PATCH') {
    return {
      name: 'API Saved Report',
      config: {
        source: 'payments',
        aggregate: 'count',
        fromDate: `${year}-01-01`,
        toDate: `${year}-12-31`,
      },
    }
  }
  if (route.path === '/api/tasks/:id' && (route.method === 'PUT' || route.method === 'PATCH')) {
    return { status: 'completed', title: 'Updated probe task' }
  }
  if (route.path === '/api/dues-recommendation' && route.method === 'POST') {
    return { yearlyPrice: 1200, memberCount: 1 }
  }
  if (route.path === '/api/auth/invite' && route.method === 'POST') {
    return { email: `org-invite-${Date.now()}@example.com`, role: 'member' }
  }
  if (route.path === '/api/auth/invite' && route.method === 'PUT') {
    return { token: 'invalid-token', password: 'ApiRouteTestPass123!', name: 'Invited' }
  }
  if (route.path === '/api/auth/reset-password' && route.method === 'PUT') {
    return { token: 'invalid-token', password: 'ApiRouteTestPass123!' }
  }
  if (route.path === '/api/families/:id/charge-saved-card' && route.method === 'POST') {
    return {
      savedPaymentMethodId: f.savedPaymentMethodId,
      amount: 10,
      paymentDate: today,
      year,
      type: 'membership',
    }
  }
  if (route.path === '/api/families/:id/saved-payment-methods' && route.method === 'POST') {
    return {
      paymentMethodId: 'pm_probemock',
      paymentIntentId: 'pi_apiprobemock',
      setAsDefault: true,
    }
  }
  if (route.path === '/api/members/:memberId/statements' && route.method === 'POST') {
    return {
      fromDate: `${year}-01-01`,
      toDate: today,
      openingBalance: 0,
    }
  }
  if (route.path === '/api/trash/:kind/:id/restore' && route.method === 'POST') {
    return {}
  }
  if (route.path === '/api/families/bulk' && route.method === 'POST') {
    return {
      action: 'setPaymentPlan',
      ids: [f.familyId],
      paymentPlanId: f.paymentPlanId,
    }
  }

  if (
    base !== undefined &&
    !(typeof base === 'object' && Object.keys(base as object).length === 0)
  ) {
    return base
  }
  if (
    route.method === 'GET' ||
    route.method === 'HEAD' ||
    route.method === 'OPTIONS' ||
    route.method === 'DELETE'
  ) {
    return undefined
  }
  return base ?? {}
}

export function deepRouteQuery(template: string, ctx: ApiTestContext): string {
  const year = new Date().getFullYear()
  const base = defaultRouteQuery(template, ctx.signupCode)
  if (template === '/api/calculations') return `?year=${year}`
  if (template === '/api/tax-receipts/zip') return `?year=${year}`
  if (template === '/api/tax-receipts/:familyId/pdf') return `?year=${year}`
  if (template === '/api/dues-recommendation') return ''
  if (template === '/api/dashboard-stats') return ''
  if (template === '/api/reports/meta') return ''
  return base
}

function routeFixtures(route: ApiRouteEntry, ctx: ApiTestContext): RouteFixtureIds {
  let fixtures = ctx.fixtures
  if (route.method === 'DELETE' && route.path === '/api/families/:id') {
    fixtures = { ...fixtures, familyId: ctx.fixtures.betaFamilyId }
  }
  if (route.method === 'DELETE' && route.path === '/api/tasks/:id') {
    fixtures = { ...fixtures, taskId: ctx.fixtures.disposableTaskId }
  }
  return fixtures
}

function applyAuthHeaders(
  route: ApiRouteEntry,
  ctx: ApiTestContext,
  headers: Record<string, string>,
): void {
  if (route.path === '/api/stripe/webhook' && route.method === 'POST') {
    headers['stripe-signature'] = 't=0,v1=api_probe'
  }
  if (route.auth === 'cron' || route.auth === 'org-or-cron') {
    const secret = process.env.CRON_SECRET || 'test-cron-secret'
    headers['x-cron-secret'] = secret
    headers.authorization = `Bearer ${secret}`
  } else if (
    route.auth === 'org' ||
    route.auth === 'platform-admin' ||
    (route.auth === 'session' && route.tenantScoped)
  ) {
    headers['x-organization-id'] = ctx.orgId
  }
}

async function buildMultipartImportRequest(
  url: string,
  headers: Record<string, string>,
  label: ImportProbeLabel = 'families-csv',
): Promise<NextRequest> {
  void url
  void headers
  return buildImportProbeRequest(label)
}

function buildMultipartFileEmailRequest(
  url: string,
  headers: Record<string, string>,
  ctx: ApiTestContext,
): NextRequest {
  const form = new FormData()
  form.set('to', ctx.email)
  form.set('subject', 'API deep probe')
  form.set('message', 'Attached probe PDF')
  const blob = new Blob(['%PDF-1.4 probe'], { type: 'application/pdf' })
  form.set('file', blob, 'probe.pdf')
  return new NextRequest(url, { method: 'POST', headers, body: form })
}

const STRIPE_WEBHOOK_EVENT_TYPES = [
  'customer.created',
  'charge.refunded',
  'charge.dispute.created',
  'charge.dispute.closed',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'charge.dispute.funds_withdrawn',
  'charge.dispute.funds_reinstated',
] as const

function stripeWebhookPayload(eventType: string): string {
  const id = `evt_deep_${eventType}_${Date.now()}`
  const base = { id, type: eventType, data: { object: { id: 'obj_probe' } } }
  if (eventType === 'charge.refunded') {
    return JSON.stringify({
      ...base,
      data: {
        object: {
          id: 'ch_probe',
          payment_intent: 'pi_apiprobemock',
          amount_refunded: 1000,
          currency: 'usd',
        },
      },
    })
  }
  if (eventType.startsWith('charge.dispute') || eventType.startsWith('payment_intent')) {
    return JSON.stringify({
      ...base,
      data: {
        object: {
          id: eventType.includes('dispute') ? 'dp_probe' : 'pi_apiprobemock',
          charge: 'ch_probe',
          status: eventType.includes('closed') ? 'won' : 'needs_response',
          payment_intent: 'pi_apiprobemock',
          metadata: {},
        },
      },
    })
  }
  return JSON.stringify(base)
}

export async function prepareDeepInvocation(
  route: ApiRouteEntry,
  ctx: ApiTestContext,
): Promise<{ request: NextRequest; params: Record<string, string>; path: string }> {
  const fixtures = routeFixtures(route, ctx)
  const path = resolveRoutePath(route.path, fixtures)
  const query = deepRouteQuery(route.path, ctx)
  const url = `${ORIGIN}${path}${query}`
  const headers: Record<string, string> = {
    host: 'localhost:3000',
    origin: ORIGIN,
  }
  applyAuthHeaders(route, ctx, headers)

  const isImport = route.path === '/api/import' && route.method === 'POST'
  const isFileEmail = route.path === '/api/send-file-email' && route.method === 'POST'
  const isStripeWebhook = route.path === '/api/stripe/webhook' && route.method === 'POST'

  if (isImport) {
    return {
      request: await buildMultipartImportRequest(url, headers, 'families-csv'),
      params: extractRouteParams(route.path, path),
      path,
    }
  }
  if (isFileEmail) {
    return {
      request: buildMultipartFileEmailRequest(url, headers, ctx),
      params: extractRouteParams(route.path, path),
      path,
    }
  }

  const body = deepProbeBody(route, ctx)
  const needsBody =
    route.method !== 'GET' &&
    route.method !== 'HEAD' &&
    route.method !== 'DELETE' &&
    route.method !== 'OPTIONS'

  if (needsBody && !isStripeWebhook) {
    headers['content-type'] = 'application/json'
  }

  const request = new NextRequest(url, {
    method: route.method,
    headers,
    body: isStripeWebhook
      ? stripeWebhookPayload('customer.created')
      : needsBody
        ? JSON.stringify(body)
        : undefined,
  })

  return {
    request,
    params: extractRouteParams(route.path, path),
    path,
  }
}

const INVALID_ID = 'not-valid'

function invalidIdFixtures(route: ApiRouteEntry, ctx: ApiTestContext): RouteFixtureIds {
  const base = routeFixtures(route, ctx)
  const out = { ...base }
  for (const key of Object.keys(out) as (keyof RouteFixtureIds)[]) {
    out[key] = INVALID_ID
  }
  return out
}

function prepareInvalidIdInvocation(
  route: ApiRouteEntry,
  ctx: ApiTestContext,
): { request: NextRequest; params: Record<string, string>; path: string } {
  const fixtures = invalidIdFixtures(route, ctx)
  const path = resolveRoutePath(route.path, fixtures)
  const query = deepRouteQuery(route.path, ctx)
  const url = `${ORIGIN}${path}${query}`
  const headers: Record<string, string> = {
    host: 'localhost:3000',
    origin: ORIGIN,
  }
  applyAuthHeaders(route, ctx, headers)

  const needsBody =
    route.method !== 'GET' &&
    route.method !== 'HEAD' &&
    route.method !== 'DELETE' &&
    route.method !== 'OPTIONS'

  if (needsBody) {
    headers['content-type'] = 'application/json'
  }

  const request = new NextRequest(url, {
    method: route.method,
    headers,
    body: needsBody ? JSON.stringify({}) : undefined,
  })

  return {
    request,
    params: extractRouteParams(route.path, path),
    path,
  }
}

function prepareEmptyBodyInvocation(
  route: ApiRouteEntry,
  ctx: ApiTestContext,
): { request: NextRequest; params: Record<string, string>; path: string } {
  const fixtures = routeFixtures(route, ctx)
  const path = resolveRoutePath(route.path, fixtures)
  const query = deepRouteQuery(route.path, ctx)
  const url = `${ORIGIN}${path}${query}`
  const headers: Record<string, string> = {
    host: 'localhost:3000',
    origin: ORIGIN,
    'content-type': 'application/json',
  }
  applyAuthHeaders(route, ctx, headers)

  const request = new NextRequest(url, {
    method: route.method,
    headers,
    body: JSON.stringify({}),
  })

  return {
    request,
    params: extractRouteParams(route.path, path),
    path,
  }
}

function routeHasIdParam(route: ApiRouteEntry): boolean {
  return /:[a-zA-Z]+/.test(route.path)
}

/** Routes that expect multipart/form-data or dedicated probe bodies — empty `{}` causes 500s. */
function skipEmptyBodyProbe(route: ApiRouteEntry): boolean {
  if (route.path === '/api/import' && route.method === 'POST') return true
  if (route.path === '/api/send-file-email' && route.method === 'POST') return true
  if (route.path === '/api/stripe/webhook' && route.method === 'POST') return true
  if (route.path === '/api/organizations/branding/logo' && route.method === 'POST') return true
  return false
}

function makeProbe(route: ApiRouteEntry, label: string, ctx: ApiTestContext): DeepProbe {
  if (label === 'invalid-id' && routeHasIdParam(route)) {
    return {
      label,
      buildRequest: (c) => prepareInvalidIdInvocation(route, c).request,
    }
  }
  if (label === 'empty-body') {
    return {
      label,
      buildRequest: (c) => prepareEmptyBodyInvocation(route, c).request,
    }
  }
  if (route.path === '/api/import' && route.method === 'POST') {
    const importLabel = label as ImportProbeLabel
    return {
      label,
      buildRequest: async () => {
        const req = await buildImportProbeRequest(importLabel, {
          familyId: ctx.fixtures.familyId,
          memberId: ctx.fixtures.memberId,
        })
        return req
      },
    }
  }
  if (route.path === '/api/stripe/webhook' && route.method === 'POST') {
    return {
      label,
      buildRequest: () => {
        const url = `${ORIGIN}/api/stripe/webhook`
        const headers: Record<string, string> = {
          host: 'localhost:3000',
          origin: ORIGIN,
          'stripe-signature': 't=0,v1=api_probe',
        }
        return new NextRequest(url, {
          method: 'POST',
          headers,
          body: stripeWebhookPayload(label),
        })
      },
    }
  }
  return {
    label,
    buildRequest: async (c) => (await prepareDeepInvocation(route, c)).request,
  }
}

export function deepProbeLabels(route: ApiRouteEntry): string[] {
  if (route.path === '/api/import' && route.method === 'POST') {
    return importProbeLabels()
  }
  if (route.path === '/api/stripe/webhook' && route.method === 'POST') {
    return [...STRIPE_WEBHOOK_EVENT_TYPES]
  }
  // Covered by sequential enrollment test in api-routes.integration.test.ts.
  if (route.path === '/api/user/2fa' && route.method === 'PATCH') {
    return []
  }
  const labels: string[] = ['success']
  if (routeHasIdParam(route)) {
    labels.push('invalid-id')
  }
  if (
    !skipEmptyBodyProbe(route) &&
    (route.method === 'POST' || route.method === 'PUT' || route.method === 'PATCH')
  ) {
    labels.push('empty-body')
  }
  return labels
}

export function getDeepProbes(route: ApiRouteEntry, ctx?: ApiTestContext): DeepProbe[] {
  const c = ctx ?? ({} as ApiTestContext)
  return deepProbeLabels(route).map((label) => makeProbe(route, label, c))
}

export function resolveDeepProbeParams(
  route: ApiRouteEntry,
  ctx: ApiTestContext,
  request: NextRequest,
): Record<string, string> {
  const path = request.nextUrl.pathname
  return extractRouteParams(route.path, path)
}
