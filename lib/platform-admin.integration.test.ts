import { describe, it, expect, vi, afterEach } from 'vitest'

import { NextResponse } from 'next/server'



const mockFindById = vi.hoisted(() => vi.fn())



vi.mock('@/app/auth', () => ({

  auth: vi.fn(),

}))

vi.mock('@/lib/database', () => ({

  default: vi.fn().mockResolvedValue(undefined),

}))

vi.mock('@/lib/models', () => ({

  User: {

    findById: mockFindById,

  },

}))



function mockUserTwoFactor(enabled: boolean) {

  mockFindById.mockReturnValue({

    select: vi.fn().mockReturnValue({

      lean: vi.fn().mockResolvedValue({ twoFactorEnabled: enabled }),

    }),

  })

}



describe('platform-admin (integration)', () => {

  const prevEmails = process.env.PLATFORM_ADMIN_EMAILS



  afterEach(() => {

    vi.resetAllMocks()

    if (prevEmails === undefined) delete process.env.PLATFORM_ADMIN_EMAILS

    else process.env.PLATFORM_ADMIN_EMAILS = prevEmails

  })



  it('requirePlatformAdmin returns 401 when there is no session', async () => {

    const { auth } = await import('@/app/auth')

    vi.mocked(auth).mockResolvedValue(null as never)



    const { requirePlatformAdmin } = await import('./platform-admin')

    const result = await requirePlatformAdmin()



    expect(result).toBeInstanceOf(NextResponse)

    expect((result as NextResponse).status).toBe(401)

  })



  it('requirePlatformAdmin returns 403 when email is not a platform admin', async () => {

    process.env.PLATFORM_ADMIN_EMAILS = 'owner@kasa.test'

    const { auth } = await import('@/app/auth')

    vi.mocked(auth).mockResolvedValue({

      user: { id: 'user-1', email: 'member@example.com', name: 'Member' },

    } as any)



    const { requirePlatformAdmin } = await import('./platform-admin')

    const result = await requirePlatformAdmin()



    expect(result).toBeInstanceOf(NextResponse)

    expect((result as NextResponse).status).toBe(403)

  })



  it('requirePlatformAdmin returns 403 when platform admin has not enabled 2FA', async () => {

    process.env.PLATFORM_ADMIN_EMAILS = 'owner@kasa.test'

    mockUserTwoFactor(false)

    const { auth } = await import('@/app/auth')

    vi.mocked(auth).mockResolvedValue({

      user: { id: 'admin-42', email: 'owner@kasa.test', name: 'Owner' },

    } as any)



    const { requirePlatformAdmin, PLATFORM_ADMIN_2FA_REQUIRED_CODE } = await import(

      './platform-admin'

    )

    const result = await requirePlatformAdmin()



    expect(result).toBeInstanceOf(NextResponse)

    expect((result as NextResponse).status).toBe(403)

    const body = await (result as NextResponse).json()

    expect(body.code).toBe(PLATFORM_ADMIN_2FA_REQUIRED_CODE)

    expect(body.error).toMatch(/two-factor authentication/i)

  })



  it('requirePlatformAdmin returns context for an allowed admin email with 2FA', async () => {

    process.env.PLATFORM_ADMIN_EMAILS = 'owner@kasa.test, backup@kasa.test'

    mockUserTwoFactor(true)

    const { auth } = await import('@/app/auth')

    vi.mocked(auth).mockResolvedValue({

      user: { id: 'admin-42', email: 'Owner@Kasa.test', name: 'Owner' },

    } as any)



    const { requirePlatformAdmin } = await import('./platform-admin')

    const result = await requirePlatformAdmin()



    expect(result).not.toBeInstanceOf(NextResponse)

    expect(result).toEqual({

      userId: 'admin-42',

      email: 'Owner@Kasa.test',

      name: 'Owner',

    })

  })

})

