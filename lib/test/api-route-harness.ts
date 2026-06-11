import fs from 'fs'
import path from 'path'
import { NextRequest, NextResponse } from 'next/server'
import type { ApiRouteEntry } from '../../security/catalog/types'
import type { ApiTestContext } from './api-route-fixtures'
import { catalogSuccessBody } from './catalog-probe-bodies'
import { defaultRouteQuery, extractRouteParams, resolveRoutePath } from './api-route-fixtures'

export type HttpMethod = ApiRouteEntry['method']

const ORIGIN = 'http://localhost:3000'

export function probeBody(route: ApiRouteEntry, ctx: ApiTestContext): unknown {
  if (route.method === 'GET' || route.method === 'HEAD' || route.method === 'OPTIONS') {
    return undefined
  }
  if (route.method === 'DELETE') {
    return undefined
  }

  const catalog = catalogSuccessBody(route, ctx)
  if (catalog !== undefined) return catalog

  if (route.path === '/api/organizations/current' && route.method === 'PATCH') {
    return { locale: 'en-US' }
  }
  if (route.path === '/api/user' && route.method === 'PATCH') {
    return { name: 'API Route Probe' }
  }
  if (route.path === '/api/user/preferences' && route.method === 'PATCH') {
    return { emailNotifications: true }
  }
  if (route.path.includes('/tasks')) {
    return {
      title: `Probe ${Date.now()}`,
      email: ctx.email,
      priority: 'low',
      status: 'pending',
    }
  }
  if (route.path === '/api/payment-plans' && route.method === 'POST') {
    return { name: `Probe Plan ${Date.now()}`, yearlyPrice: 100 }
  }
  if (route.path === '/api/lifecycle-event-types' && route.method === 'POST') {
    const tag = `probe_${Date.now()}`
    return { type: tag, name: 'Probe Event', amount: 10 }
  }
  if (route.path === '/api/families' && route.method === 'POST') {
    return {
      name: `Probe Family ${Date.now()}`,
      weddingDate: '2018-01-01',
      husbandFirstName: 'Probe',
      husbandLastName: 'Family',
      paymentPlanId: ctx.fixtures.paymentPlanId,
    }
  }
  if (route.path === '/api/auth/signup' && route.method === 'POST') {
    return {
      inviteCode: ctx.signupCode,
      password: 'ApiRouteTestPass123!',
      name: 'Invite Target',
    }
  }
  if (route.path === '/api/auth/request-invite' && route.method === 'POST') {
    return {
      email: `request-${Date.now()}@example.com`,
      name: 'Requester',
      message: 'api route probe',
    }
  }
  if (route.path === '/api/auth/reset-password' && route.method === 'POST') {
    return { email: 'nobody@example.com' }
  }
  if (route.path === '/api/auth/precheck-2fa' && route.method === 'POST') {
    return { email: ctx.email, password: 'wrong-password' }
  }
  if (route.path === '/api/reports/run' && route.method === 'POST') {
    const year = new Date().getFullYear()
    return {
      source: 'payments',
      aggregate: 'count',
      fromDate: `${year}-01-01`,
      toDate: `${year}-12-31`,
    }
  }
  if (route.path === '/api/reports/saved' && route.method === 'POST') {
    const year = new Date().getFullYear()
    return {
      name: `Probe Report ${Date.now()}`,
      config: {
        source: 'payments',
        aggregate: 'count',
        fromDate: `${year}-01-01`,
        toDate: `${year}-12-31`,
      },
    }
  }
  if (route.path === '/api/families/bulk' && route.method === 'POST') {
    return {
      action: 'setEmailOptOut',
      ids: [ctx.fixtures.familyId],
      emailOptOut: false,
    }
  }
  if (route.path === '/api/import' && route.method === 'POST') {
    return undefined
  }
  if (route.path === '/api/stripe/create-payment-intent' && route.method === 'POST') {
    // Valid ObjectId shape but not seeded — exits before Stripe API call.
    return { familyId: '000000000000000000000001', amount: 100 }
  }
  if (route.path === '/api/stripe/confirm-payment' && route.method === 'POST') {
    return {
      paymentIntentId: 'pi_apiprobemock',
      familyId: ctx.fixtures.familyId,
    }
  }
  if (route.path === '/api/stripe/webhook' && route.method === 'POST') {
    return undefined
  }
  if (route.path === '/api/email-config/test' && route.method === 'POST') {
    return {}
  }
  if (route.path === '/api/tax-receipts/email' && route.method === 'POST') {
    return { year: new Date().getFullYear(), familyIds: [ctx.fixtures.familyId] }
  }
  if (route.path === '/api/statements/send-single-email' && route.method === 'POST') {
    return { familyId: ctx.fixtures.familyId }
  }
  if (route.path === '/api/statements/send-emails' && route.method === 'POST') {
    return {}
  }
  if (route.path === '/api/statements/generate-monthly' && route.method === 'POST') {
    return {}
  }
  if (route.path === '/api/statements/auto-generate' && route.method === 'POST') {
    return {}
  }
  if (route.path === '/api/statements/send-monthly-emails' && route.method === 'POST') {
    return {}
  }
  if (route.path === '/api/send-file-email' && route.method === 'POST') {
    return undefined
  }
  if (route.path === '/api/trash/purge-all' && route.method === 'POST') {
    return {}
  }
  if (route.path === '/api/admin/invite-requests' && route.method === 'PATCH') {
    return { status: 'rejected' }
  }
  return {}
}

export function buildApiRequest(
  route: ApiRouteEntry,
  ctx: ApiTestContext,
  resolvedPath: string,
): NextRequest {
  const query = defaultRouteQuery(route.path, ctx.signupCode)
  const url = `${ORIGIN}${resolvedPath}${query}`
  const headers: Record<string, string> = {
    host: 'localhost:3000',
    origin: ORIGIN,
  }

  if (route.path === '/api/stripe/webhook' && route.method === 'POST') {
    headers['stripe-signature'] = 't=0,v1=probe'
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

  const body = probeBody(route, ctx)
  const isStripeWebhook =
    route.path === '/api/stripe/webhook' && route.method === 'POST'
  const isMultipartProbe =
    (route.path === '/api/import' || route.path === '/api/send-file-email') &&
    route.method === 'POST'

  if (isMultipartProbe) {
    const form = new FormData()
    if (route.path === '/api/import') {
      form.set('type', 'families')
    } else {
      form.set('to', ctx.email)
      form.set('subject', 'API route probe')
      form.set('message', 'probe')
    }
    return new NextRequest(url, {
      method: route.method,
      headers,
      body: form,
    })
  }

  const needsBody =
    (body !== undefined || isStripeWebhook) &&
    route.method !== 'GET' &&
    route.method !== 'HEAD' &&
    route.method !== 'DELETE'

  if (needsBody && !isStripeWebhook) {
    headers['content-type'] = 'application/json'
  }

  return new NextRequest(url, {
    method: route.method,
    headers,
    body: isStripeWebhook
      ? '{}'
      : needsBody
        ? JSON.stringify(body)
        : undefined,
  })
}

/** Map catalog `app/api/.../route.ts` to `lib/route-logic/...` implementation. */

const API_HANDLERS_ROOT = path.join(process.cwd(), 'lib', 'api-handlers')

const API_HANDLER_ALIASES: Record<string, string> = {
  'jobs/generate-monthly-statements/worker': 'jobs/generate-monthly-statements-worker',
}

function apiHandlerModuleForRoute(rel: string): string | null {
  const handlerRel = API_HANDLER_ALIASES[rel] ?? rel
  const handlerPath = path.join(API_HANDLERS_ROOT, ...handlerRel.split('/'), 'handler.ts')
  if (fs.existsSync(handlerPath)) {
    return `@/lib/api-handlers/${handlerRel}/handler`
  }
  return null
}

/** Map catalog `app/api/.../route.ts` to handler implementation (api-handlers or route-logic). */
export function routeSourceToLogicModule(source: string): string {
  const rel = source
    .replace(/\\/g, '/')
    .replace(/^app\/api\//, '')
    .replace(/\/route\.ts$/, '')
  return apiHandlerModuleForRoute(rel) ?? `@/lib/route-logic/${rel}`
}

export async function invokeApiRoute(
  route: ApiRouteEntry,
  request: NextRequest,
  params: Record<string, string>,
): Promise<NextResponse> {
  const importPath = routeSourceToLogicModule(route.source)
  const mod = (await import(importPath)) as Record<
    string,
    (req: NextRequest, ctx: { params: Record<string, string> }) => Promise<NextResponse>
  >
  const handler = mod[route.method]
  if (!handler) {
    throw new Error(`No ${route.method} export in ${route.source}`)
  }
  return handler(request, { params })
}

export function prepareRouteInvocation(
  route: ApiRouteEntry,
  ctx: ApiTestContext,
): { request: NextRequest; params: Record<string, string>; path: string } {
  let fixtures = ctx.fixtures
  if (route.method === 'DELETE' && route.path === '/api/families/:id') {
    fixtures = { ...fixtures, familyId: ctx.fixtures.betaFamilyId }
  }
  const path = resolveRoutePath(route.path, fixtures)
  const request = buildApiRequest(route, ctx, path)
  const params = extractRouteParams(route.path, path)
  return { request, params, path }
}

export function expectRouteStatus(
  route: ApiRouteEntry,
  response: NextResponse,
): void {
  const status = response.status
  if (status >= 500) {
    throw new Error(`${route.method} ${route.path} returned ${status}`)
  }
  if (route.auth === 'webhook' || route.auth === 'nextauth' || route.auth === 'public') {
    return
  }
  if (route.auth === 'cron') {
    if (status === 401) {
      throw new Error(`${route.method} ${route.path} cron auth failed (${status})`)
    }
    return
  }
  if (status === 401) {
    throw new Error(`${route.method} ${route.path} unauthorized (${status})`)
  }
}
