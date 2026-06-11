import type { APIRequestContext } from '@playwright/test'
import { alphaOrgName } from '../auth/roles'
import { getOrgByName } from '../auth/roles'
import { mutateRequest } from './request-mutation'

export interface RouteFixtureIds {
  familyId: string
  memberId: string
  taskId: string
  paymentPlanId: string
  lifecycleEventTypeId: string
  statementId: string
  withdrawalId: string
}

const PLACEHOLDER_IDS: Record<string, string> = {
  id: '507f1f77bcf86cd799439011',
  memberId: '507f1f77bcf86cd799439012',
  familyId: '507f1f77bcf86cd799439011',
  taskId: '507f1f77bcf86cd799439013',
  withdrawalId: '507f1f77bcf86cd799439014',
  kind: 'families',
}

/** Resolve :param segments using live seed data where possible. */
export function defaultRouteFixtures(): RouteFixtureIds {
  return {
    familyId: PLACEHOLDER_IDS.id,
    memberId: PLACEHOLDER_IDS.memberId,
    taskId: PLACEHOLDER_IDS.taskId,
    paymentPlanId: PLACEHOLDER_IDS.id,
    lifecycleEventTypeId: PLACEHOLDER_IDS.id,
    statementId: PLACEHOLDER_IDS.id,
    withdrawalId: PLACEHOLDER_IDS.withdrawalId,
  }
}

export async function resolveRouteFixtures(
  request: APIRequestContext,
): Promise<RouteFixtureIds> {
  const fixtures = defaultRouteFixtures()

  const alpha = await getOrgByName(request, alphaOrgName())
  if (!alpha) return fixtures

  const search = await mutateRequest(request, {
    method: 'GET',
    path: `/api/search?q=${encodeURIComponent('Alpha Marker')}`,
  })
  if (search.ok()) {
    const data = (await search.json()) as { items?: Array<{ type: string; id: string }> }
    const family = data.items?.find((i) => i.type === 'family')
    if (family?.id) fixtures.familyId = family.id
  }

  const famRes = await mutateRequest(request, {
    method: 'GET',
    path: `/api/families/${fixtures.familyId}`,
  })
  if (famRes.ok()) {
    const fam = (await famRes.json()) as { members?: Array<{ _id: string }> }
    if (fam.members?.[0]?._id) fixtures.memberId = fam.members[0]._id
  }

  const tasks = await mutateRequest(request, { method: 'GET', path: '/api/tasks' })
  if (tasks.ok()) {
    const list: unknown = await tasks.json()
    const arr = Array.isArray(list)
      ? (list as Array<{ _id?: string }>)
      : (list as { tasks?: Array<{ _id?: string }> }).tasks
    if (arr?.[0]?._id) fixtures.taskId = arr[0]._id
  }

  const plans = await mutateRequest(request, { method: 'GET', path: '/api/payment-plans' })
  if (plans.ok()) {
    const list = (await plans.json()) as Array<{ _id?: string }>
    if (list?.[0]?._id) fixtures.paymentPlanId = list[0]._id
  }

  const types = await mutateRequest(request, { method: 'GET', path: '/api/lifecycle-event-types' })
  if (types.ok()) {
    const list = (await types.json()) as Array<{ _id?: string }>
    if (list?.[0]?._id) fixtures.lifecycleEventTypeId = list[0]._id
  }

  const stmts = await mutateRequest(request, { method: 'GET', path: '/api/statements?limit=1' })
  if (stmts.ok()) {
    const body: unknown = await stmts.json()
    const arr = Array.isArray(body)
      ? (body as Array<{ _id?: string }>)
      : (body as { statements?: Array<{ _id?: string }> }).statements
    if (arr?.[0]?._id) fixtures.statementId = arr[0]._id
  }

  const withdrawals = await mutateRequest(request, {
    method: 'GET',
    path: `/api/families/${fixtures.familyId}/withdrawals`,
  })
  if (withdrawals.ok()) {
    const list = (await withdrawals.json()) as Array<{ _id?: string }>
    if (list?.[0]?._id) fixtures.withdrawalId = list[0]._id
  }

  return fixtures
}

export function resolveRoutePath(template: string, fixtures: RouteFixtureIds): string {
  let path = template
  const map: Record<string, string> = {
    id: fixtures.familyId,
    familyId: fixtures.familyId,
    memberId: fixtures.memberId,
    taskId: fixtures.taskId,
    withdrawalId: fixtures.withdrawalId,
    kind: 'families',
  }
  for (const [key, value] of Object.entries(map)) {
    path = path.replace(`:${key}`, value)
  }
  for (const [key, fallback] of Object.entries(PLACEHOLDER_IDS)) {
    path = path.replace(`:${key}`, fallback)
  }
  return path
}
