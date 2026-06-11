import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { Types } from 'mongoose'
import { setupMongo, teardownMongo } from './test/mongo-memory'

const ACTIVE_ORG_COOKIE = 'kasa_active_org'
type Role = 'owner' | 'admin' | 'member'

vi.mock('server-only', () => ({}))

const reactCacheStore = vi.hoisted(() => new Map<unknown, Promise<unknown>>())

vi.mock('react', () => ({
  cache: <T extends (...args: never[]) => Promise<unknown>>(fn: T): T => {
    return (async (...args) => {
      if (!reactCacheStore.has(fn)) {
        reactCacheStore.set(fn, fn(...args))
      }
      return reactCacheStore.get(fn) as Promise<Awaited<ReturnType<T>>>
    }) as T
  },
}))

vi.mock('@/app/auth', () => ({
  auth: vi.fn(),
}))

const mockCookieGet = vi.fn()
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({
    get: mockCookieGet,
  })),
}))

const redirectMock = vi.fn((url: string): never => {
  throw Object.assign(new Error('NEXT_REDIRECT'), { url })
})
vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}))

async function seedUserWithOrg(options?: {
  role?: Role
  setLastActive?: boolean
}) {
  const { User, Organization, OrgMembership } = await import('./models')
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const user = await User.create({
    email: `auth-server-${suffix}@example.com`,
    hashedPassword: 'hashed-test-password',
    name: 'Server User',
  })
  const org = await Organization.create({
    name: 'Server Org',
    slug: `auth-server-org-${suffix}`,
    ownerId: user._id,
  })
  await OrgMembership.create({
    userId: user._id,
    organizationId: org._id,
    role: options?.role ?? 'owner',
  })
  if (options?.setLastActive !== false) {
    await User.findByIdAndUpdate(user._id, { lastActiveOrganizationId: org._id })
  }
  return { user, org }
}

describe('auth-server', () => {
  beforeAll(async () => {
    vi.resetModules()
    await setupMongo()
  })

  afterAll(async () => {
    await teardownMongo()
  })

  afterEach(async () => {
    vi.clearAllMocks()
    mockCookieGet.mockReset()
    redirectMock.mockClear()
    reactCacheStore.clear()
    const { User, Organization, OrgMembership } = await import('./models')
    await Promise.all([
      OrgMembership.deleteMany({}),
      Organization.deleteMany({}),
      User.deleteMany({ email: /@example\.com$/ }),
    ])
  })

  describe('getCachedAuth', () => {
    it('memoizes auth() across repeated calls', async () => {
      const { auth } = await import('@/app/auth')
      const session = {
        user: {
          id: new Types.ObjectId().toString(),
          email: 'c@example.com',
          name: 'C',
        },
      }
      vi.mocked(auth).mockResolvedValue(session as any)

      const { getCachedAuth } = await import('./auth-server')
      const first = await getCachedAuth()
      const second = await getCachedAuth()

      expect(first).toBe(second)
      expect(auth).toHaveBeenCalledTimes(1)
    })
  })

  describe('getServerOrgContext', () => {
    it('returns null when there is no authenticated user', async () => {
      const { auth } = await import('@/app/auth')
      vi.mocked(auth).mockResolvedValue(null as never)

      const { getServerOrgContext } = await import('./auth-server')
      const ctx = await getServerOrgContext()

      expect(ctx).toBeNull()
    })

    it('resolves org and role from cookie and JWT memberships', async () => {
      const orgId = new Types.ObjectId().toString()
      const { auth } = await import('@/app/auth')
      const userId = new Types.ObjectId().toString()
      vi.mocked(auth).mockResolvedValue({
        user: {
          id: userId,
          email: 'jwt@example.com',
          name: 'JWT User',
          memberships: [{ o: orgId, r: 'admin' }],
        },
      } as any)
      mockCookieGet.mockImplementation((name: string) =>
        name === ACTIVE_ORG_COOKIE ? { value: orgId } : undefined,
      )

      const { getServerOrgContext } = await import('./auth-server')
      const ctx = await getServerOrgContext()

      expect(ctx).toEqual({
        userId,
        email: 'jwt@example.com',
        name: 'JWT User',
        organizationId: orgId,
        role: 'admin',
      })
    })

    it('falls back to lastActiveOrganizationId and DB role lookup', async () => {
      const { user, org } = await seedUserWithOrg({ role: 'member' })
      const { auth } = await import('@/app/auth')
      vi.mocked(auth).mockResolvedValue({
        user: {
          id: user._id.toString(),
          email: user.email,
          name: user.name,
        },
      } as any)

      const { getServerOrgContext } = await import('./auth-server')
      const ctx = await getServerOrgContext()

      expect(ctx).toEqual({
        userId: user._id.toString(),
        email: user.email,
        name: user.name,
        organizationId: org._id.toString(),
        role: 'member',
      })
    })

    it('falls back to first membership when user has no lastActiveOrganizationId', async () => {
      const { user, org } = await seedUserWithOrg({
        role: 'admin',
        setLastActive: false,
      })
      const { auth } = await import('@/app/auth')
      vi.mocked(auth).mockResolvedValue({
        user: {
          id: user._id.toString(),
          email: user.email,
          name: user.name,
        },
      } as any)

      const { getServerOrgContext } = await import('./auth-server')
      const ctx = await getServerOrgContext()

      expect(ctx?.organizationId).toBe(org._id.toString())
      expect(ctx?.role).toBe('admin')
    })

    it('returns null when org id is invalid', async () => {
      const { auth } = await import('@/app/auth')
      vi.mocked(auth).mockResolvedValue({
        user: {
          id: new Types.ObjectId().toString(),
          email: 'a@b.com',
          name: 'A',
        },
      } as any)
      mockCookieGet.mockImplementation((name: string) =>
        name === ACTIVE_ORG_COOKIE ? { value: 'not-valid' } : undefined,
      )

      const { getServerOrgContext } = await import('./auth-server')
      const ctx = await getServerOrgContext()

      expect(ctx).toBeNull()
    })

    it('returns null when user is not a member of the active org', async () => {
      const { user } = await seedUserWithOrg()
      const otherOrgId = new Types.ObjectId().toString()
      const { auth } = await import('@/app/auth')
      vi.mocked(auth).mockResolvedValue({
        user: {
          id: user._id.toString(),
          email: user.email,
          name: user.name,
          memberships: [],
        },
      } as any)
      mockCookieGet.mockImplementation((name: string) =>
        name === ACTIVE_ORG_COOKIE ? { value: otherOrgId } : undefined,
      )

      const { getServerOrgContext } = await import('./auth-server')
      const ctx = await getServerOrgContext()

      expect(ctx).toBeNull()
    })
  })

  describe('requireServerOrgContext', () => {
    it('redirects to /login when there is no org context', async () => {
      const { auth } = await import('@/app/auth')
      vi.mocked(auth).mockResolvedValue(null as never)

      const { requireServerOrgContext } = await import('./auth-server')

      await expect(requireServerOrgContext()).rejects.toMatchObject({
        message: 'NEXT_REDIRECT',
        url: '/login',
      })
      expect(redirectMock).toHaveBeenCalledWith('/login')
    })

    it('redirects to / when minRole is not met', async () => {
      const orgId = new Types.ObjectId().toString()
      const { auth } = await import('@/app/auth')
      vi.mocked(auth).mockResolvedValue({
        user: {
          id: new Types.ObjectId().toString(),
          email: 'low@example.com',
          name: 'Low',
          memberships: [{ o: orgId, r: 'member' }],
        },
      } as any)
      mockCookieGet.mockImplementation((name: string) =>
        name === ACTIVE_ORG_COOKIE ? { value: orgId } : undefined,
      )

      const { requireServerOrgContext } = await import('./auth-server')

      await expect(
        requireServerOrgContext({ minRole: 'admin' }),
      ).rejects.toMatchObject({ url: '/' })
      expect(redirectMock).toHaveBeenCalledWith('/')
    })

    it('returns context when user meets minRole', async () => {
      const orgId = new Types.ObjectId().toString()
      const { auth } = await import('@/app/auth')
      const userId = new Types.ObjectId().toString()
      vi.mocked(auth).mockResolvedValue({
        user: {
          id: userId,
          email: 'admin@example.com',
          name: 'Admin',
          memberships: [{ o: orgId, r: 'admin' }],
        },
      } as any)
      mockCookieGet.mockImplementation((name: string) =>
        name === ACTIVE_ORG_COOKIE ? { value: orgId } : undefined,
      )

      const { requireServerOrgContext } = await import('./auth-server')
      const ctx = await requireServerOrgContext({ minRole: 'admin' })

      expect(ctx).toEqual({
        userId,
        email: 'admin@example.com',
        name: 'Admin',
        organizationId: orgId,
        role: 'admin',
      })
      expect(redirectMock).not.toHaveBeenCalled()
    })
  })
})
