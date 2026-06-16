import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  seedApiRouteFixtures,
  teardownApiRouteFixtures,
  type ApiTestContext,
} from '@/lib/test/api-route-fixtures'

const mockAuth = vi.hoisted(() => vi.fn())
const mockCookieGet = vi.hoisted(() => vi.fn())

vi.mock('@/app/auth', () => ({
  auth: mockAuth,
  handlers: { GET: vi.fn(), POST: vi.fn() },
  signIn: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: mockCookieGet })),
}))

const API_ORIGIN = 'http://localhost:3000'
let ctx: ApiTestContext

function bindSession(c: ApiTestContext) {
  mockAuth.mockResolvedValue({
    user: {
      id: c.userId,
      email: c.email,
      name: c.userName,
      memberships: [
        { o: c.orgId, r: 'owner' },
        { o: c.betaOrgId, r: 'owner' },
      ],
    },
  } as never)
  mockCookieGet.mockImplementation((name: string) =>
    name === 'kasa_active_org' ? { value: c.orgId } : undefined,
  )
}

function orgJsonReq(
  path: string,
  method: string,
  body?: unknown,
  opts?: { orgId?: string },
): NextRequest {
  const headers: Record<string, string> = {
    host: 'localhost:3000',
    origin: API_ORIGIN,
    'content-type': 'application/json',
    'x-organization-id': opts?.orgId ?? ctx.orgId,
  }
  return new NextRequest(new URL(path, API_ORIGIN), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

describe('GET /api/organizations/setup-progress', () => {
  beforeAll(async () => {
    ctx = await seedApiRouteFixtures()
    bindSession(ctx)
  })

  afterAll(async () => {
    await teardownApiRouteFixtures()
  })

  it('returns all steps complete for a fully configured org', async () => {
    const { GET } = await import('@/lib/route-logic/organizations/setup-progress')
    const res = await GET(orgJsonReq('/api/organizations/setup-progress', 'GET'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.complete).toBe(true)
    expect(body.completed).toBe(5)
    expect(body.total).toBe(5)
    expect(body.steps).toHaveLength(5)
    expect(body.steps.every((s: { done: boolean }) => s.done)).toBe(true)
    expect(body.steps.find((s: { id: string }) => s.id === 'paymentPlans')?.href).toBe(
      '/settings?tab=paymentPlans',
    )
    expect(body.steps.find((s: { id: string }) => s.id === 'email')?.href).toBe(
      '/settings?tab=email',
    )
  })

  it('returns partial progress for a sparse org', async () => {
    const { GET } = await import('@/lib/route-logic/organizations/setup-progress')
    const res = await GET(
      orgJsonReq('/api/organizations/setup-progress', 'GET', undefined, {
        orgId: ctx.betaOrgId,
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.complete).toBe(false)
    expect(body.completed).toBeLessThan(5)
    const byId = Object.fromEntries(body.steps.map((s: { id: string; done: boolean }) => [s.id, s.done]))
    expect(byId.firstFamily).toBe(true)
    expect(byId.paymentPlans).toBe(false)
    expect(byId.eventTypes).toBe(false)
    expect(byId.email).toBe(false)
    expect(byId.firstPayment).toBe(false)
  })

  it('rejects members without admin role', async () => {
    mockAuth.mockResolvedValueOnce({
      user: {
        id: ctx.fixtures.memberUserId,
        email: 'member@example.com',
        name: 'Member',
        memberships: [{ o: ctx.orgId, r: 'member' }],
      },
    } as never)

    const { GET } = await import('@/lib/route-logic/organizations/setup-progress')
    const res = await GET(orgJsonReq('/api/organizations/setup-progress', 'GET'))
    expect(res.status).toBe(403)
    bindSession(ctx)
  })
})
