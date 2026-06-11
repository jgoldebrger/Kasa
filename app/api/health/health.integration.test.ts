import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { setupMongo, teardownMongo } from '@/lib/test/mongo-memory'

vi.mock('@/app/auth', () => ({
  auth: vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({ get: vi.fn() })),
}))

const API_ORIGIN = 'http://localhost:3000'

function healthReq(): NextRequest {
  return new NextRequest(`${API_ORIGIN}/api/health`, {
    method: 'GET',
    headers: { host: 'localhost:3000', origin: API_ORIGIN },
  })
}

describe('GET /api/health (integration)', () => {
  beforeAll(async () => {
    await setupMongo()
  })

  afterAll(async () => {
    await teardownMongo()
  })

  it('returns 200 and ok when MongoDB is reachable', async () => {
    const { GET } = await import('@/lib/route-logic/health')
    const res = await GET(healthReq(), { params: {} })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      status: 'ok',
      checks: { mongodb: 'ok' },
    })
    expect(typeof body.timestamp).toBe('string')
  })

  it('route.ts re-export serves the same handler', async () => {
    const { GET } = await import('./route')
    const res = await GET(healthReq(), { params: {} })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
  })

  it('returns 503 when connectDB fails', async () => {
    const database = await import('@/lib/database')
    const spy = vi.spyOn(database, 'default').mockRejectedValueOnce(new Error('connection refused'))
    try {
      const { GET } = await import('@/lib/route-logic/health')
      const res = await GET(healthReq(), { params: {} })
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body).toMatchObject({
        status: 'unhealthy',
        checks: { mongodb: 'error' },
      })
    } finally {
      spy.mockRestore()
    }
  })
})
