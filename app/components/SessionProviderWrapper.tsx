'use client'

import { SessionProvider } from 'next-auth/react'
import type { Session } from 'next-auth'

export default function SessionProviderWrapper({
  children,
  session,
}: {
  children: React.ReactNode
  session?: Session | null
}) {
  // NextAuth defaults: refetchInterval = 0 but `refetchOnWindowFocus` is true
  // AND it pings /api/auth/session on every navigation that uses `useSession`.
  // Both behaviors are noisy on a SaaS app where the session rarely changes
  // mid-tab. We're using JWT sessions backed by a httpOnly cookie that the
  // middleware revalidates on every request, so disabling these is safe.
  return (
    <SessionProvider
      session={session}
      refetchOnWindowFocus={false}
      refetchInterval={0}
      refetchWhenOffline={false}
    >
      {children}
    </SessionProvider>
  )
}
