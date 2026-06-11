'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Backwards-compat redirect — the members UI now lives as a tab inside
 * `/settings`. Old links land here and bounce.
 */
export default function MembersRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/settings?tab=members')
  }, [router])
  return (
    <div className="p-6 text-sm text-fg-muted">Redirecting to Settings…</div>
  )
}
