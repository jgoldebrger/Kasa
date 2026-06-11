import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  connectDB: vi.fn(async () => undefined),
  insertMany: vi.fn(async () => []),
  create: vi.fn(async () => ({})),
  orgFindLean: vi.fn(async () => [] as { userId: string }[]),
}))

vi.mock('./database', () => ({
  default: mocks.connectDB,
}))

vi.mock('./models', () => ({
  OrgMembership: {
    find: vi.fn(() => ({
      select: vi.fn(() => ({
        lean: mocks.orgFindLean,
      })),
    })),
  },
  User: {},
  Notification: {
    insertMany: mocks.insertMany,
    create: mocks.create,
  },
}))

import { OrgMembership } from './models'
import { notifyAdmins, notifyOrg, notifyUser } from './notify'

describe('notifyAdmins', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.orgFindLean.mockResolvedValue([])
    mocks.insertMany.mockResolvedValue([])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates one notification per owner/admin membership', async () => {
    mocks.orgFindLean.mockResolvedValue([
      { userId: 'user-owner' },
      { userId: 'user-admin' },
    ])

    await notifyAdmins('org-1', {
      kind: 'payment.failed',
      title: 'Payment declined',
      body: 'Card declined',
      link: '/tasks',
      metadata: { amount: 100 },
    })

    expect(OrgMembership.find).toHaveBeenCalledWith({
      organizationId: 'org-1',
      role: { $in: ['owner', 'admin'] },
    })
    expect(mocks.insertMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          organizationId: 'org-1',
          userId: 'user-owner',
          kind: 'payment.failed',
          title: 'Payment declined',
          body: 'Card declined',
          link: '/tasks',
          metadata: { amount: 100 },
        }),
        expect.objectContaining({
          organizationId: 'org-1',
          userId: 'user-admin',
          kind: 'payment.failed',
        }),
      ],
      { ordered: false },
    )
  })

  it('does not insert when no admins are found', async () => {
    mocks.orgFindLean.mockResolvedValue([])

    await notifyAdmins('org-1', { kind: 'test', title: 'T' })

    expect(mocks.insertMany).not.toHaveBeenCalled()
  })

  it('swallows errors without throwing', async () => {
    mocks.orgFindLean.mockRejectedValue(new Error('db down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      notifyAdmins('org-1', { kind: 'test', title: 'T' }),
    ).resolves.toBeUndefined()

    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })
})

describe('notifyUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.create.mockResolvedValue({})
  })

  it('creates a single notification row', async () => {
    await notifyUser('org-1', 'user-1', {
      kind: 'invite.accepted',
      title: 'Welcome',
      body: 'Joined',
    })

    expect(mocks.create).toHaveBeenCalledWith({
      organizationId: 'org-1',
      userId: 'user-1',
      kind: 'invite.accepted',
      title: 'Welcome',
      body: 'Joined',
      link: '',
      metadata: {},
    })
  })

  it('swallows create errors', async () => {
    mocks.create.mockRejectedValue(new Error('write failed'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(notifyUser('org-1', 'u', { kind: 'k', title: 't' })).resolves.toBeUndefined()
    errSpy.mockRestore()
  })
})

describe('notifyOrg', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.create.mockResolvedValue({})
  })

  it('creates an org-wide notification with null userId', async () => {
    await notifyOrg('org-1', { kind: 'system', title: 'Maintenance' })
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        userId: null,
        kind: 'system',
        title: 'Maintenance',
      }),
    )
  })

  it('swallows create errors without throwing', async () => {
    mocks.create.mockRejectedValue(new Error('write failed'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      notifyOrg('org-1', { kind: 'system', title: 'Down' }),
    ).resolves.toBeUndefined()

    expect(errSpy).toHaveBeenCalledWith('[notify] notifyOrg failed:', expect.any(Error))
    errSpy.mockRestore()
  })
})
