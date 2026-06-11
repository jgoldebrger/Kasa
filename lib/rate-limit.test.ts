import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import connectDB from './database'

beforeAll(async () => {
  await connectDB()
}, 120_000)

afterAll(async () => {
  const m = await import('mongoose')
  const mg = (m as { default?: typeof import('mongoose') }).default ?? m
  if (mg.connection?.readyState !== 0) {
    await mg.disconnect().catch(() => {})
  }
})

beforeEach(async () => {
  const m = await import('mongoose')
  const mg = (m as { default?: typeof import('mongoose') }).default ?? m
  const collections = mg.connection.collections
  for (const k in collections) {
    await collections[k].deleteMany({})
  }
})

// Import AFTER mongoose is connected so the module's `connectDB()` no-ops.
async function getCheck() {
  const mod = await import('./rate-limit')
  return mod.checkRateLimit
}

function fakeReq(): Request {
  return new Request('http://localhost/test', { headers: { 'x-forwarded-for': '127.0.0.1' } })
}

describe('checkRateLimit (mongo-backed)', () => {
  it('allows the first request and decrements remaining', async () => {
    const check = await getCheck()
    const v = await check(fakeReq(), 'test-scope-1', { limit: 3, windowMs: 60_000 })
    expect(v.allowed).toBe(true)
    expect(v.remaining).toBe(2)
  })

  it('blocks once the limit is exceeded', async () => {
    const check = await getCheck()
    const opts = { limit: 2, windowMs: 60_000 }
    const a = await check(fakeReq(), 'test-scope-2', opts)
    const b = await check(fakeReq(), 'test-scope-2', opts)
    const c = await check(fakeReq(), 'test-scope-2', opts)
    expect(a.allowed).toBe(true)
    expect(b.allowed).toBe(true)
    expect(c.allowed).toBe(false)
    expect(c.remaining).toBe(0)
  })

  it('uses independent buckets per scope', async () => {
    const check = await getCheck()
    const opts = { limit: 1, windowMs: 60_000 }
    const a = await check(fakeReq(), 'scope-a', opts)
    const b = await check(fakeReq(), 'scope-b', opts)
    expect(a.allowed).toBe(true)
    expect(b.allowed).toBe(true)
  })

  it('uses independent buckets when an extraKey is supplied', async () => {
    const check = await getCheck()
    const opts = { limit: 1, windowMs: 60_000 }
    const a = await check(fakeReq(), 'login-email', opts, 'alice@example.com')
    const b = await check(fakeReq(), 'login-email', opts, 'bob@example.com')
    expect(a.allowed).toBe(true)
    expect(b.allowed).toBe(true)
  })

  it('fails open when upsert returns no document', async () => {
    await getCheck()
    const mongoose = (await import('mongoose')).default
    const RateLimit = mongoose.models.RateLimit as unknown as { findOneAndUpdate: ReturnType<typeof vi.fn> }
    const lean = vi.fn().mockResolvedValue(null)
    const spy = vi.spyOn(RateLimit, 'findOneAndUpdate').mockReturnValue({ lean } as never)

    const check = await getCheck()
    const v = await check(fakeReq(), 'upsert-null-doc', { limit: 2, windowMs: 30_000 })

    expect(v.allowed).toBe(true)
    expect(v.remaining).toBe(1)
    spy.mockRestore()
  })
})
