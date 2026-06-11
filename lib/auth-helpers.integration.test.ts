import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { Types } from 'mongoose'
import { setupMongo, teardownMongo } from './test/mongo-memory'

const ACTIVE_ORG_COOKIE = 'kasa_active_org'
type Role = 'owner' | 'admin' | 'member'

vi.mock('@/app/auth', () => ({
  auth: vi.fn(),
}))

const mockCookieGet = vi.fn()
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({
    get: mockCookieGet,
  })),
}))

async function seedUserWithOrg(options?: {
  role?: Role
  setLastActive?: boolean
  userName?: string
}) {
  const { User, Organization, OrgMembership } = await import('./models')
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const user = await User.create({
    email: `auth-test-${suffix}@example.com`,
    hashedPassword: 'hashed-test-password',
    name: options?.userName ?? 'Jane Doe',
  })
  const org = await Organization.create({
    name: 'Test Org',
    slug: `auth-test-org-${suffix}`,
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

function nextRequestWithOrg(orgId: string): NextRequest {
  return new NextRequest('https://app.test/api/test', {
    headers: { 'x-organization-id': orgId },
  })
}

describe('auth-helpers (integration)', () => {
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
    const { User, Organization, OrgMembership } = await import('./models')
    await Promise.all([
      OrgMembership.deleteMany({}),
      Organization.deleteMany({}),
      User.deleteMany({ email: /@example\.com$/ }),
    ])
  })

  describe('hasMinRole', () => {
    it('compares roles by hierarchy', async () => {
      const { hasMinRole } = await import('./auth-helpers')
      expect(hasMinRole('owner', 'member')).toBe(true)
      expect(hasMinRole('admin', 'admin')).toBe(true)
      expect(hasMinRole('member', 'admin')).toBe(false)
    })
  })

  describe('requireSession', () => {
    it('returns 401 when there is no session', async () => {
      const { auth } = await import('@/app/auth')
      vi.mocked(auth).mockResolvedValue(null as never)

      const { requireSession } = await import('./auth-helpers')
      const result = await requireSession()

      expect(result).toBeInstanceOf(NextResponse)
      expect((result as NextResponse).status).toBe(401)
    })

    it('returns 401 when session has no user id', async () => {
      const { auth } = await import('@/app/auth')
      vi.mocked(auth).mockResolvedValue({ user: { email: 'a@b.com' } } as any)

      const { requireSession } = await import('./auth-helpers')
      const result = await requireSession()

      expect(result).toBeInstanceOf(NextResponse)
      expect((result as NextResponse).status).toBe(401)
    })

    it('returns normalized AuthedSession for a valid session', async () => {
      const { auth } = await import('@/app/auth')
      vi.mocked(auth).mockResolvedValue({
        user: {
          id: 'user-abc',
          email: 'jane@example.com',
          name: 'Jane',
          memberships: [{ o: '507f1f77bcf86cd799439011', r: 'owner' }],
        },
      } as any)

      const { requireSession } = await import('./auth-helpers')
      const result = await requireSession()

      expect(result).not.toBeInstanceOf(NextResponse)
      expect(result).toEqual({
        user: {
          id: 'user-abc',
          email: 'jane@example.com',
          name: 'Jane',
          memberships: [{ o: '507f1f77bcf86cd799439011', r: 'owner' }],
        },
      })
    })
  })

  describe('getCurrentOrgId', () => {
    it('prefers x-organization-id header on the request', async () => {
      const { getCurrentOrgId } = await import('./auth-helpers')
      const req = nextRequestWithOrg('507f1f77bcf86cd799439011')

      const orgId = await getCurrentOrgId(req, 'any-user-id')

      expect(orgId).toBe('507f1f77bcf86cd799439011')
      expect(mockCookieGet).not.toHaveBeenCalled()
    })

    it('reads org id from the active-org cookie', async () => {
      const { user, org } = await seedUserWithOrg()
      mockCookieGet.mockImplementation((name: string) =>
        name === ACTIVE_ORG_COOKIE ? { value: org._id.toString() } : undefined,
      )

      const { getCurrentOrgId } = await import('./auth-helpers')
      const orgId = await getCurrentOrgId(undefined, user._id.toString())

      expect(orgId).toBe(org._id.toString())
    })

    it('falls back to lastActiveOrganizationId on the user', async () => {
      const { user, org } = await seedUserWithOrg()

      const { getCurrentOrgId } = await import('./auth-helpers')
      const orgId = await getCurrentOrgId(undefined, user._id.toString())

      expect(orgId).toBe(org._id.toString())
    })

    it('falls back to the first OrgMembership when user has no lastActiveOrganizationId', async () => {
      const { user, org } = await seedUserWithOrg({ setLastActive: false })

      const { getCurrentOrgId } = await import('./auth-helpers')
      const orgId = await getCurrentOrgId(undefined, user._id.toString())

      expect(orgId).toBe(org._id.toString())
    })

    it('returns null when user has no orgs', async () => {
      const { User } = await import('./models')
      const user = await User.create({
        email: `lonely-${Date.now()}@example.com`,
        hashedPassword: 'hash',
        name: 'Lonely',
      })

      const { getCurrentOrgId } = await import('./auth-helpers')
      const orgId = await getCurrentOrgId(undefined, user._id.toString())

      expect(orgId).toBeNull()
    })
  })

  describe('requireOrg', () => {
    it('returns 401 when session is missing', async () => {
      const { auth } = await import('@/app/auth')
      vi.mocked(auth).mockResolvedValue(null as never)

      const { requireOrg } = await import('./auth-helpers')
      const result = await requireOrg()

      expect(result).toBeInstanceOf(NextResponse)
      expect((result as NextResponse).status).toBe(401)
    })

    it('returns 400 when user has no active organization', async () => {
      const { User } = await import('./models')
      const user = await User.create({
        email: `no-org-${Date.now()}@example.com`,
        hashedPassword: 'hash',
        name: 'No Org',
      })
      const { auth } = await import('@/app/auth')
      vi.mocked(auth).mockResolvedValue({
        user: { id: user._id.toString(), email: user.email, name: user.name },
      } as any)

      const { requireOrg } = await import('./auth-helpers')
      const result = await requireOrg()

      expect(result).toBeInstanceOf(NextResponse)
      expect((result as NextResponse).status).toBe(400)
      const body = await (result as NextResponse).json()
      expect(body).toEqual({ error: 'No active organization' })
    })

    it('returns 400 for an invalid organization id', async () => {
      const { user } = await seedUserWithOrg()
      const { auth } = await import('@/app/auth')
      vi.mocked(auth).mockResolvedValue({
        user: { id: user._id.toString(), email: user.email, name: user.name },
      } as any)
      mockCookieGet.mockImplementation((name: string) =>
        name === ACTIVE_ORG_COOKIE ? { value: 'not-a-valid-id' } : undefined,
      )

      const { requireOrg } = await import('./auth-helpers')
      const result = await requireOrg()

      expect(result).toBeInstanceOf(NextResponse)
      expect((result as NextResponse).status).toBe(400)
      const body = await (result as NextResponse).json()
      expect(body).toEqual({ error: 'Invalid organization id' })
    })

    it('resolves role from JWT memberships without a DB lookup', async () => {
      const { user, org } = await seedUserWithOrg({ role: 'admin' })
      const { auth } = await import('@/app/auth')
      vi.mocked(auth).mockResolvedValue({
        user: {
          id: user._id.toString(),
          email: user.email,
          name: user.name,
          memberships: [{ o: org._id.toString(), r: 'admin' }],
        },
      } as any)

      const { OrgMembership } = await import('./models')
      const findSpy = vi.spyOn(OrgMembership, 'findOne')

      const { requireOrg } = await import('./auth-helpers')
      const result = await requireOrg(nextRequestWithOrg(org._id.toString()))

      expect(result).not.toBeInstanceOf(NextResponse)
      expect(result).toMatchObject({
        userId: user._id.toString(),
        organizationId: org._id.toString(),
        role: 'admin',
      })
      expect(findSpy).not.toHaveBeenCalled()
      findSpy.mockRestore()
    })

    it('falls back to OrgMembership when JWT memberships are empty', async () => {
      const { user, org } = await seedUserWithOrg({ role: 'member' })
      const { auth } = await import('@/app/auth')
      vi.mocked(auth).mockResolvedValue({
        user: {
          id: user._id.toString(),
          email: user.email,
          name: user.name,
          memberships: [],
        },
      } as any)

      const { requireOrg } = await import('./auth-helpers')
      const result = await requireOrg(nextRequestWithOrg(org._id.toString()))

      expect(result).not.toBeInstanceOf(NextResponse)
      expect(result).toMatchObject({
        organizationId: org._id.toString(),
        role: 'member',
      })
    })

    it('returns 403 when user is not a member of the organization', async () => {
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

      const { requireOrg } = await import('./auth-helpers')
      const result = await requireOrg(nextRequestWithOrg(otherOrgId))

      expect(result).toBeInstanceOf(NextResponse)
      expect((result as NextResponse).status).toBe(403)
    })

    it('returns 403 when role is below minRole', async () => {
      const { user, org } = await seedUserWithOrg({ role: 'member' })
      const { auth } = await import('@/app/auth')
      vi.mocked(auth).mockResolvedValue({
        user: {
          id: user._id.toString(),
          email: user.email,
          name: user.name,
          memberships: [{ o: org._id.toString(), r: 'member' }],
        },
      } as any)

      const { requireOrg } = await import('./auth-helpers')
      const result = await requireOrg(nextRequestWithOrg(org._id.toString()), {
        minRole: 'admin',
      })

      expect(result).toBeInstanceOf(NextResponse)
      expect((result as NextResponse).status).toBe(403)
      const body = await (result as NextResponse).json()
      expect(body).toEqual({ error: 'Requires admin role' })
    })

    it('honors explicit orgId option', async () => {
      const { user, org } = await seedUserWithOrg({ role: 'owner' })
      const { auth } = await import('@/app/auth')
      vi.mocked(auth).mockResolvedValue({
        user: {
          id: user._id.toString(),
          email: user.email,
          name: user.name,
          memberships: [{ o: org._id.toString(), r: 'owner' }],
        },
      } as any)

      const { requireOrg } = await import('./auth-helpers')
      const result = await requireOrg(undefined, { orgId: org._id.toString() })

      expect(result).not.toBeInstanceOf(NextResponse)
      expect(result).toMatchObject({
        organizationId: org._id.toString(),
        role: 'owner',
      })
    })
  })

  describe('createPersonalOrganization', () => {
    it('creates org, owner membership, and sets lastActiveOrganizationId', async () => {
      const { User, Organization, OrgMembership } = await import('./models')
      const user = await User.create({
        email: `new-user-${Date.now()}@example.com`,
        hashedPassword: 'hash',
        name: 'Alice Smith',
      })

      const { createPersonalOrganization } = await import('./auth-helpers')
      const org = await createPersonalOrganization(
        user._id.toString(),
        'Alice Smith',
      )

      expect(org.name).toBe('Personal workspace')
      expect(org.slug).toMatch(/^alice-smith/)
      expect(String(org.ownerId)).toBe(user._id.toString())

      const membership = await OrgMembership.findOne({
        userId: user._id,
        organizationId: org._id,
      }).lean() as import('@/lib/test/type-helpers').LeanDoc | null
      expect(membership?.role).toBe('owner')

      const refreshed = await User.findById(user._id).lean() as import('@/lib/test/type-helpers').LeanDoc | null
      expect(String(refreshed?.lastActiveOrganizationId)).toBe(org._id.toString())
    })

    it('appends a numeric suffix when the base slug already exists', async () => {
      const { User, Organization } = await import('./models')
      const ownerId = new Types.ObjectId()
      await Organization.create({
        name: 'Existing',
        slug: 'bob-jones',
        ownerId,
      })
      const user = await User.create({
        email: `bob-${Date.now()}@example.com`,
        hashedPassword: 'hash',
        name: 'Bob Jones',
      })

      const { createPersonalOrganization } = await import('./auth-helpers')
      const org = await createPersonalOrganization(
        user._id.toString(),
        'Bob Jones',
      )

      expect(org.slug).toBe('bob-jones-1')
    })
  })
})
