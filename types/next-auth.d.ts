import type { DefaultSession } from 'next-auth'
import type { SessionMembership } from './auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      memberships?: SessionMembership[]
      isPlatformAdmin?: boolean
    } & DefaultSession['user']
  }

  interface User {
    id: string
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string
    isPlatformAdmin?: boolean
    memberships?: SessionMembership[]
    pwdCheckedAt?: number
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    id?: string
    isPlatformAdmin?: boolean
    memberships?: SessionMembership[]
    pwdCheckedAt?: number
  }
}

declare module '@auth/core/types' {
  interface Session {
    user: {
      id: string
      memberships?: SessionMembership[]
      isPlatformAdmin?: boolean
    } & DefaultSession['user']
  }

  interface User {
    id: string
  }
}
